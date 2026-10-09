// Use case: component provisioning state machine.
//
// Given a components row in the catalog, runs the pending steps in order,
// logging each transition to provision_log:
//
//   pending ──repo──▶ repo_created ──secrets──▶ secrets_written
//   secrets_written ──vars──▶ vars_written
//   vars_written ──manifest──▶ manifest_pr_opened ──▶ ready
//
// Every step is idempotent: it checks external state before acting, so a
// 'failed' component can be retried and resumes from the last good status.

import sodium from 'libsodium-wrappers';
import { validComponentName, validRepoName, validShortname, shortnameFor,
  resolveConfig, BRANCH_STRATEGIES } from '../../domain/component.js';

// What the provisioner materializes into each new repo, per template kind.
// Values come from the platform credential store (Supabase) — secrets are
// written as GitHub repo secrets, vars as GitHub repo variables, matching
// the *Id references declared in deploy-manifest's infrastructures.
// VERCEL_PROJECT_ID is written empty: the infra is created lazily by the
// deploy workflow (scripts/ensure-vercel-project.sh) on first deploy.
const SPECS = {
  app: {
    key: 'app',
    manifest: true,
    secrets: ['VERCEL_TOKEN', 'DOCKER_TOKEN', 'ORCHESTRATOR_TOKEN', 'GRAFANA_OTLP_AUTH'],
    vars: ['VERCEL_ORG_ID', 'VERCEL_PROJECT_ID', 'DOCKER_USERNAME', 'DEPLOY_ENVIRONMENTS',
      'GRAFANA_OTLP_ENDPOINT'],
  },
  lib: {
    key: 'lib',
    manifest: false, // libs publish to Central, they are not deploy components
    secrets: ['SONATYPE_USERNAME', 'SONATYPE_TOKEN', 'GPG_PRIVATE_KEY', 'GPG_PASSPHRASE',
      'GRAFANA_OTLP_AUTH'],
    vars: ['GRAFANA_OTLP_ENDPOINT'],
  },
};

export const specFor = (kind) => SPECS[kind];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const provisionComponent = ({ catalog, store, repoHost, templates }) => {
  const gh = repoHost.api;
  const OWNER = repoHost.owner;
  const MANIFEST_REPO = repoHost.manifestRepo;

  // Resolves the template's provisioning spec from the catalog row —
  // the registered kind is authoritative over any naming convention.
  async function specOf(comp) {
    const tpl = await templates.get(comp.template);
    const spec = tpl && specFor(tpl.kind);
    if (!spec) throw new Error(`unknown template '${comp.template}'`);
    return spec;
  }

  // --- Steps ---------------------------------------------------------------

  async function stepRepo(comp) {
    const repoName = comp.repo.split('/')[1];
    let created = false;
    try {
      await gh(`/repos/${OWNER}/${repoName}`);
    } catch {
      const tpl = await gh(`/repos/${OWNER}/${comp.template}`);
      if (!tpl.is_template)
        throw new Error(`${comp.template} is not marked as a template repository`);
      await gh(`/repos/${OWNER}/${comp.template}/generate`, {
        method: 'POST',
        body: { owner: OWNER, name: repoName, description: comp.description,
          private: false, include_all_branches: false },
      });
      created = true;
    }

    // GitHub's generate endpoint copies only the template's default branch.
    // The component's branch strategy decides what the repo converges to:
    //   gitflow → protected main + development (development = default)
    //   trunk   → protected main only (development is dropped if copied)
    // Repo init is racy right after generation — retry.
    const strategy = comp.branch_strategy === 'trunk' ? 'trunk' : 'gitflow';
    const wanted = strategy === 'trunk' ? ['main'] : ['main', 'development'];
    const defaultBranch = strategy === 'trunk' ? 'main' : 'development';
    let branches;
    for (let i = 0; i < 8; i++) {
      branches = await gh(`/repos/${OWNER}/${repoName}/branches?per_page=100`).catch(() => []);
      if (branches.length) break;
      await sleep(1500);
    }
    const sha = branches[0]?.commit?.sha;
    if (!sha) throw new Error(`repo ${OWNER}/${repoName} has no branches after generation`);
    for (const name of wanted) {
      if (branches.some((b) => b.name === name)) continue;
      await gh(`/repos/${OWNER}/${repoName}/git/refs`, {
        method: 'POST', body: { ref: `refs/heads/${name}`, sha },
      });
    }
    const repo = await gh(`/repos/${OWNER}/${repoName}`, {
      method: 'PATCH', body: { default_branch: defaultBranch },
    });
    if (strategy === 'trunk' && branches.some((b) => b.name === 'development'))
      await gh(`/repos/${OWNER}/${repoName}/git/refs/heads/development`, { method: 'DELETE' });
    // Same policy as the org's other repos: PR required (0 approvals),
    // admins enforced, no force-push, no delete.
    for (const name of wanted) {
      await gh(`/repos/${OWNER}/${repoName}/branches/${name}/protection`, {
        method: 'PUT',
        body: {
          required_status_checks: null,
          enforce_admins: true,
          required_pull_request_reviews: { required_approving_review_count: 0 },
          restrictions: null,
          allow_force_pushes: false,
          allow_deletions: false,
        },
      });
    }
    return { repo_created: created, default_branch: repo.default_branch,
      branch_strategy: strategy, protected: wanted };
  }

  async function stepSecrets(comp, cfg) {
    const spec = await specOf(comp);
    const names = spec.secrets.filter((n) => cfg[n]);
    const skipped = spec.secrets.filter((n) => !cfg[n]);
    await sodium.ready;
    const { key, key_id } = await gh(`/repos/${comp.repo}/actions/secrets/public-key`);
    for (const name of names) {
      const sealed = sodium.crypto_box_seal(cfg[name],
        sodium.from_base64(key, sodium.base64_variants.ORIGINAL));
      await gh(`/repos/${comp.repo}/actions/secrets/${name}`, {
        method: 'PUT',
        body: { encrypted_value: sodium.to_base64(sealed, sodium.base64_variants.ORIGINAL),
          key_id },
      });
    }
    return { secrets_written: names, secrets_skipped: skipped };
  }

  async function stepVars(comp, cfg) {
    const spec = await specOf(comp);
    const written = [];
    for (const name of spec.vars) {
      // Placeholder vars are written empty and resolved lazily downstream
      // (VERCEL_PROJECT_ID is filled by the first deploy run).
      const value = name === 'VERCEL_PROJECT_ID' ? '' : cfg[name];
      if (!value && name !== 'VERCEL_PROJECT_ID') continue;
      try {
        await gh(`/repos/${comp.repo}/actions/variables`, {
          method: 'POST', body: { name, value } });
      } catch (e) {
        if (!/409|already exists/i.test(e.message)) throw e;
        await gh(`/repos/${comp.repo}/actions/variables/${name}`, {
          method: 'PATCH', body: { value } });
      }
      written.push(name);
    }
    return { vars_written: written };
  }

  // Insert the infra block (app components only) and the component entry
  // into manifest.yml, bump its version, and open the registration PR.
  async function stepManifest(comp) {
    if (!(await specOf(comp)).manifest)
      return { skipped: 'lib template: not a deploy component' };
    const repoName = comp.repo.split('/')[1];
    const file = await gh(`/repos/${MANIFEST_REPO}/contents/manifest.yml?ref=main`);
    let text = Buffer.from(file.content, 'base64').toString('utf8');
    if (new RegExp(`^  - name: ${comp.name}\\s*$`, 'm').test(text))
      return { skipped: 'component already in manifest' };

    text = text.replace(/^version: (\d+)\.(\d+)\.\d+/m,
      (_m, maj, min) => `version: ${maj}.${Number(min) + 1}.0`);

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
    const open = await gh(
      `/repos/${MANIFEST_REPO}/pulls?head=${MANIFEST_REPO.split('/')[0]}:${branch}&base=main&state=open`);
    if (open.length) {
      pr = open[0];
    } else {
      pr = await gh(`/repos/${MANIFEST_REPO}/pulls`, {
        method: 'POST',
        body: {
          title: `Register component ${comp.name}`,
          head: branch,
          base: 'main',
          body: `Provisions \`${comp.repo}\` (template \`${comp.template}\`).\n\n- component \`${comp.name}\`\n- infra \`${comp.name}-pro\` (vercel)\n\nManifest CI validates that tag \`0.1.0\` exists — merge after the repo's first release.\n\nGenerated by deploy-orchestrator.`,
        },
      });
    }
    return { manifest_pr: pr.number, manifest_pr_url: pr.html_url };
  }

  const STEPS = [
    { from: 'pending', to: 'repo_created', run: stepRepo },
    { from: 'repo_created', to: 'secrets_written', run: stepSecrets },
    { from: 'secrets_written', to: 'vars_written', run: stepVars },
    { from: 'vars_written', to: 'manifest_pr_opened', run: stepManifest },
  ];

  const running = new Set();

  // Executes every pending step for the component. Throws on failure — the
  // row ends in status 'failed' with the offending step in provision_log,
  // and a later call resumes from the last completed status.
  async function provision(name) {
    if (running.has(name)) throw new Error(`provisioning already running for ${name}`);
    running.add(name);
    try {
      let comp = await catalog.get(name);
      if (!comp) throw new Error(`component ${name} not found`);
      // Platform credential store (Supabase) with env vars as local fallback.
      const stored = await store.all();
      const cfg = new Proxy(process.env, { get: (e, k) => stored[k] ?? e[k] });
      for (const step of STEPS) {
        if (comp.status !== step.from) continue;
        try {
          const detail = await step.run(comp, cfg);
          const fields = {};
          if (detail?.manifest_pr) fields.manifest_pr = detail.manifest_pr;
          comp = await catalog.logStep(name, step.to, { step: step.to, ok: true, ...detail }, fields);
        } catch (e) {
          await catalog.logStep(name, 'failed', { step: step.to, ok: false, error: String(e.message || e) });
          throw e;
        }
      }
      if (comp.status === 'manifest_pr_opened')
        comp = await catalog.logStep(name, 'ready', { step: 'ready', ok: true });
      return comp;
    } finally {
      running.delete(name);
    }
  }

  return provision;
};

// Use case: validate + persist the catalog row, then provision it.
// Returns { status, ... } — the REST adapter maps it to HTTP.
export const createComponent = ({ catalog, repoHost, templates, provision }) =>
  async ({ name, shortname, repo, description = '', template, config, createdBy }) => {
    if (!validComponentName(name))
      return { status: 400, error: 'name must be lowercase letters, digits and hyphens' };
    if (!validRepoName(repo))
      return { status: 400, error: 'repo must be a valid GitHub repository name' };
    if (!String(description).trim())
      return { status: 400, error: 'description is required' };
    const short = shortname || shortnameFor(name);
    if (!validShortname(short))
      return { status: 400, error: 'shortname must be uppercase letters and digits' };

    let tpl;
    try {
      tpl = await templates.get(template);
    } catch (e) {
      return { status: 502, error: String(e.message || e) };
    }
    if (!tpl)
      return { status: 400, error: `unknown template '${template}'` };
    if (await catalog.get(name))
      return { status: 409, error: `component '${name}' already exists` };

    // Personalización answers are resolved server-side against the
    // template's declared fields — fixed values are authoritative, select
    // values must match a declared option.
    const resolved = resolveConfig(tpl.fields, config || {});
    const branchStrategy = BRANCH_STRATEGIES.includes(resolved.branch_strategy)
      ? resolved.branch_strategy : 'gitflow';

    const row = await catalog.create({
      name,
      shortname: short,
      repo: `${repoHost.owner}/${repo}`,
      description: String(description).slice(0, 500),
      template,
      branch_strategy: branchStrategy,
      config: resolved,
      created_by: createdBy,
    });

    try {
      return { status: 201, component: await provision(row.name) };
    } catch (e) {
      return { status: 502, error: String(e.message || e), component: await catalog.get(name) };
    }
  };
