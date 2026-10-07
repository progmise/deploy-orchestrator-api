// Component provisioning engine.
//
// Given a components row in Supabase, runs the pending steps of the state
// machine in order, logging each transition to provision_log:
//
//   pending ──repo──▶ repo_created ──secrets──▶ secrets_written
//   secrets_written ──vercel──▶ vercel_project_created ──vars──▶ vars_written
//   vars_written ──manifest──▶ manifest_pr_opened ──▶ ready
//
// Every step is idempotent: it checks external state before acting, so a
// 'failed' component can be retried and resumes from the last good status.

import sodium from 'libsodium-wrappers';
import { getComponent, logStep } from './db.js';

const GH_TOKEN = process.env.PROVISIONING_TOKEN || '';
const OWNER = process.env.GITHUB_OWNER || 'progmise';
const MANIFEST_REPO = process.env.MANIFEST_REPO || 'progmise/deploy-manifest';
const VERCEL_TOKEN = process.env.VERCEL_TOKEN || '';
const VERCEL_TEAM_ID = process.env.VERCEL_TEAM_ID || '';

// What the provisioner materializes into each new repo, per template kind.
// Values come from this service's env (the "credential store") — secrets are
// written as GitHub repo secrets, vars as GitHub repo variables, matching the
// *Id references declared in deploy-manifest's infrastructures.
const SPECS = {
  app: {
    vercel: true,
    manifest: true,
    secrets: ['VERCEL_TOKEN', 'DOCKER_TOKEN', 'ORCHESTRATOR_TOKEN'],
    vars: ['VERCEL_ORG_ID', 'DOCKER_USERNAME', 'DEPLOY_ENVIRONMENTS'],
  },
  lib: {
    vercel: false,
    manifest: false, // libs publish to Central, they are not deploy components
    secrets: ['SONATYPE_USERNAME', 'SONATYPE_TOKEN', 'GPG_PRIVATE_KEY', 'GPG_PASSPHRASE'],
    vars: [],
  },
};

export const specFor = (template) => SPECS[/-lib-template$/.test(template) ? 'lib' : 'app'];

// --- GitHub ------------------------------------------------------------------

async function gh(path, { method = 'GET', body } = {}) {
  const r = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${GH_TOKEN}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`github ${method} ${path} → ${r.status}: ${data.message || ''}`.trim());
  return data;
}

export async function listTemplates() {
  const repos = await gh(`/users/${OWNER}/repos?per_page=100&type=owner&sort=updated`);
  return repos
    .filter((r) => r.is_template)
    .map((r) => ({ name: r.name, description: r.description, kind: specFor(r.name) === SPECS.lib ? 'lib' : 'app' }));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- Steps --------------------------------------------------------------------

async function stepRepo(comp) {
  const repoName = comp.repo.split('/')[1];
  let created = false;
  try {
    await gh(`/repos/${OWNER}/${repoName}`);
  } catch {
    await gh(`/repos/${OWNER}/${comp.template}/generate`, {
      method: 'POST',
      body: { owner: OWNER, name: repoName, description: comp.description, private: false, include_all_branches: false },
    });
    created = true;
  }

  // GitHub's generate endpoint copies only the template's default branch.
  // Our convention is main + development: ensure both exist and development
  // is the default. Repo init is racy right after generation — retry.
  let branches;
  for (let i = 0; i < 8; i++) {
    branches = await gh(`/repos/${OWNER}/${repoName}/branches?per_page=100`).catch(() => []);
    if (branches.length) break;
    await sleep(1500);
  }
  const sha = branches[0]?.commit?.sha;
  if (!sha) throw new Error(`repo ${OWNER}/${repoName} has no branches after generation`);
  for (const name of ['main', 'development']) {
    if (branches.some((b) => b.name === name)) continue;
    await gh(`/repos/${OWNER}/${repoName}/git/refs`, {
      method: 'POST', body: { ref: `refs/heads/${name}`, sha },
    });
  }
  const repo = await gh(`/repos/${OWNER}/${repoName}`, {
    method: 'PATCH', body: { default_branch: 'development' },
  });
  return { repo_created: created, default_branch: repo.default_branch };
}

async function stepSecrets(comp) {
  const spec = specFor(comp.template);
  const names = spec.secrets.filter((n) => process.env[n]);
  const skipped = spec.secrets.filter((n) => !process.env[n]);
  await sodium.ready;
  const { key, key_id } = await gh(`/repos/${comp.repo}/actions/secrets/public-key`);
  for (const name of names) {
    const sealed = sodium.crypto_box_seal(process.env[name], sodium.from_base64(key, sodium.base64_variants.ORIGINAL));
    await gh(`/repos/${comp.repo}/actions/secrets/${name}`, {
      method: 'PUT',
      body: { encrypted_value: sodium.to_base64(sealed, sodium.base64_variants.ORIGINAL), key_id },
    });
  }
  return { secrets_written: names, secrets_skipped: skipped };
}

async function stepVercel(comp) {
  if (!specFor(comp.template).vercel) return { skipped: 'lib template: no vercel project' };
  const repoName = comp.repo.split('/')[1];
  const team = VERCEL_TEAM_ID ? `?teamId=${encodeURIComponent(VERCEL_TEAM_ID)}` : '';
  const call = (path, opts = {}) =>
    fetch(`https://api.vercel.com${path}${team}`, {
      ...opts,
      headers: {
        Authorization: `Bearer ${VERCEL_TOKEN}`,
        ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(opts.body ? { body: JSON.stringify(opts.body) } : {}),
    });
  let project;
  const get = await call(`/v9/projects/${encodeURIComponent(repoName)}`);
  if (get.ok) {
    project = await get.json();
  } else {
    const post = await call(`/v11/projects`, { method: 'POST', body: { name: repoName, framework: null } });
    const data = await post.json().catch(() => ({}));
    if (!post.ok) throw new Error(`vercel create project → ${post.status}: ${data.error?.message || ''}`.trim());
    project = data;
  }
  return { vercel_project_id: project.id };
}

async function stepVars(comp) {
  const spec = specFor(comp.template);
  const vars = [...spec.vars];
  if (spec.vercel) vars.push('VERCEL_PROJECT_ID');
  const written = [];
  for (const name of vars) {
    const value = name === 'VERCEL_PROJECT_ID' ? comp.vercel_project_id : process.env[name];
    if (!value) continue;
    const body = { name, value };
    try {
      await gh(`/repos/${comp.repo}/actions/variables`, { method: 'POST', body });
    } catch (e) {
      if (!/409|already exists/i.test(e.message)) throw e;
      await gh(`/repos/${comp.repo}/actions/variables/${name}`, { method: 'PATCH', body: { value } });
    }
    written.push(name);
  }
  return { vars_written: written };
}

// Insert the infra block (app components only) and the component entry into
// manifest.yml, bump its version, and open the registration PR.
async function stepManifest(comp) {
  if (!specFor(comp.template).manifest) return { skipped: 'lib template: not a deploy component' };
  const repoName = comp.repo.split('/')[1];
  const file = await gh(`/repos/${MANIFEST_REPO}/contents/manifest.yml?ref=main`);
  let text = Buffer.from(file.content, 'base64').toString('utf8');
  if (new RegExp(`^  - name: ${comp.name}\\s*$`, 'm').test(text))
    return { skipped: 'component already in manifest' };

  text = text.replace(/^version: (\d+)\.(\d+)\.\d+/m, (_m, maj, min) => `version: ${maj}.${Number(min) + 1}.0`);

  const infra = [
    `      - id: ${comp.name}-pro`,
    `        type: vercel`,
    `        properties:`,
    `          project: ${repoName}`,
    `          orgId: VERCEL_ORG_ID`,
    `          projectId: VERCEL_PROJECT_ID`,
    `          credentialsId: VERCEL_TOKEN`,
    ``,
  ].join('\n');
  if (!/^components:/m.test(text)) throw new Error('manifest has no components section');
  text = text.replace(/^components:/m, `${infra}components:`);

  const entry = [
    `  - name: ${comp.name}`,
    `    repo: ${comp.repo}`,
    `    tag: "0.1.0"`,
    `    needs: []`,
    `    infra: [${comp.name}-pro]`,
    ``,
  ].join('\n');
  text = text.endsWith('\n') ? text + entry : `${text}\n${entry}`;

  const main = await gh(`/repos/${MANIFEST_REPO}/git/ref/heads/main`);
  const branch = `component/${comp.name}`;
  try {
    await gh(`/repos/${MANIFEST_REPO}/git/refs`, {
      method: 'POST', body: { ref: `refs/heads/${branch}`, sha: main.object.sha },
    });
  } catch (e) {
    if (!/Reference already exists/.test(e.message)) throw e;
  }
  await gh(`/repos/${MANIFEST_REPO}/contents/manifest.yml`, {
    method: 'PUT',
    body: {
      message: `Register component ${comp.name}`,
      content: Buffer.from(text).toString('base64'),
      sha: (await gh(`/repos/${MANIFEST_REPO}/contents/manifest.yml?ref=${branch}`)).sha,
      branch,
    },
  });

  let pr;
  const open = await gh(`/repos/${MANIFEST_REPO}/pulls?head=${MANIFEST_REPO.split('/')[0]}:${branch}&base=main&state=open`);
  if (open.length) {
    pr = open[0];
  } else {
    pr = await gh(`/repos/${MANIFEST_REPO}/pulls`, {
      method: 'POST',
      body: {
        title: `Register component ${comp.name}`,
        head: branch,
        base: 'main',
        body: `Provisions \`${comp.repo}\` (template \`${comp.template}\`).\n\n- component \`${comp.name}\`\n- infra \`${comp.name}-pro\` (vercel)\n\nGenerated by deploy-orchestrator.`,
      },
    });
  }
  return { manifest_pr: pr.number, manifest_pr_url: pr.html_url };
}

const STEPS = [
  { from: 'pending', to: 'repo_created', run: stepRepo },
  { from: 'repo_created', to: 'secrets_written', run: stepSecrets },
  { from: 'secrets_written', to: 'vercel_project_created', run: stepVercel },
  { from: 'vercel_project_created', to: 'vars_written', run: stepVars },
  { from: 'vars_written', to: 'manifest_pr_opened', run: stepManifest },
];

const running = new Set();

// Executes every pending step for the component. Throws on failure — the row
// ends in status 'failed' with the offending step in provision_log, and a
// later call resumes from the last completed status.
export async function provision(name) {
  if (running.has(name)) throw new Error(`provisioning already running for ${name}`);
  running.add(name);
  try {
    let comp = await getComponent(name);
    if (!comp) throw new Error(`component ${name} not found`);
    for (const step of STEPS) {
      if (comp.status !== step.from) continue;
      try {
        const detail = await step.run(comp);
        const fields = {};
        if (detail?.vercel_project_id) fields.vercel_project_id = detail.vercel_project_id;
        if (detail?.manifest_pr) fields.manifest_pr = detail.manifest_pr;
        comp = await logStep(name, step.to, { step: step.to, ok: true, ...detail }, fields);
      } catch (e) {
        await logStep(name, 'failed', { step: step.to, ok: false, error: String(e.message || e) });
        throw e;
      }
    }
    if (comp.status === 'manifest_pr_opened')
      comp = await logStep(name, 'ready', { step: 'ready', ok: true });
    return comp;
  } finally {
    running.delete(name);
  }
}

export const provisioningEnabled = () => Boolean(GH_TOKEN);
