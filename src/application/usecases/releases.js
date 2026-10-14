// Use cases: release registry. A dashboard release (RLSE<number>) wraps a
// deploy-manifest GitHub Release: `version` links them (tag v<version>).
// Publish and per-env deploys go through repoHost with the admin token —
// the frontend never touches GitHub directly for these actions.

const SEMVER = /^\d+\.\d+\.\d+$/;
export const releaseNo = (n) => `RLSE${String(n).padStart(7, '0')}`;

// Manifest YAML is strict-generated; env names sit at `  - name: X` inside
// the environments: section (components use the same indent but appear
// after `components:`).
const envNamesOf = (yamlText) => {
  const section = yamlText.split(/^components:/m)[0] || '';
  return [...section.matchAll(/^  - name:\s*(\S+)/gm)].map((m) => m[1]);
};

const manifestRelease = async (repoHost, manifestRepo, version) => {
  const releases = await repoHost.api(
    `/repos/${manifestRepo}/releases?per_page=30`);
  return releases.find((r) => r.tag_name === `v${version}`) || null;
};

const manifestEnvs = async (repoHost, manifestRepo, version) => {
  try {
    const file = await repoHost.api(
      `/repos/${manifestRepo}/contents/manifest.yml?ref=v${version}`);
    return envNamesOf(Buffer.from(file.content, 'base64').toString('utf8'));
  } catch {
    return [];
  }
};

const decorate = (row, ghRelease) => ({
  ...row,
  release_no: releaseNo(row.number),
  published: ghRelease ? !ghRelease.draft : false,
  gh_release_url: ghRelease?.html_url || null,
});

// Options for the "Nueva release" form: every deploy-manifest GitHub
// Release (drafts first, then published — like Gluon's "Versión OAM" list)
// plus the deployment trails derivable from the manifest's environments.
export const releaseOptions = ({ repoHost, manifestRepo }) =>
  async () => {
    const [ghReleases, file] = await Promise.all([
      repoHost.api(`/repos/${manifestRepo}/releases?per_page=50`)
        .catch(() => []),
      repoHost.api(`/repos/${manifestRepo}/contents/manifest.yml?ref=main`)
        .catch(() => null),
    ]);
    const versions = ghReleases
      .filter((r) => SEMVER.test(r.tag_name.replace(/^v/, '')))
      .sort((a, b) => Number(a.draft) - Number(b.draft)
        || b.tag_name.localeCompare(a.tag_name, undefined, { numeric: true }))
      .map((r) => ({
        version: r.tag_name.replace(/^v/, ''), draft: r.draft,
        name: r.name || r.tag_name,
      }));
    const envs = file
      ? envNamesOf(Buffer.from(file.content, 'base64').toString('utf8'))
      : [];
    return {
      versions,
      trails: envs.length
        ? [{ name: `${envs.join('-')}-trails`, environments: envs }]
        : [],
    };
  };

export const listReleases = ({ releases, repoHost, manifestRepo }) =>
  async () => {
    const [rows, ghReleases] = await Promise.all([
      releases.list(),
      repoHost.api(`/repos/${manifestRepo}/releases?per_page=30`)
        .catch(() => []),
    ]);
    const byTag = Object.fromEntries(
      ghReleases.map((r) => [r.tag_name, r]));
    return rows.map((r) => decorate(r, byTag[`v${r.version}`]));
  };

export const createRelease = ({ releases }) =>
  async ({ version, description, planned_date, trail, deploy_start,
    deploy_end, createdBy }) => {
    const v = String(version || '').trim();
    if (!SEMVER.test(v)) return { status: 400, error: 'version must be semver (x.y.z)' };
    if (!String(description || '').trim())
      return { status: 400, error: 'description required' };
    if (planned_date && Number.isNaN(Date.parse(planned_date)))
      return { status: 400, error: 'planned_date must be a date (YYYY-MM-DD)' };
    for (const [key, ts] of [['deploy_start', deploy_start], ['deploy_end', deploy_end]])
      if (ts && Number.isNaN(Date.parse(ts)))
        return { status: 400, error: `${key} must be a datetime` };
    if (deploy_start && deploy_end && Date.parse(deploy_end) <= Date.parse(deploy_start))
      return { status: 400, error: 'deploy_end must be after deploy_start' };
    const release = await releases.create({
      version: v, description: description.trim(),
      planned_date: planned_date || null, created_by: createdBy || null,
      trail: trail || null,
      deploy_start: deploy_start || null, deploy_end: deploy_end || null,
    });
    return { status: 201, release };
  };

// Non-final statuses get re-polled against the run on every detail read.
const FINAL = new Set(['success', 'failure', 'cancelled']);

const refreshDeployments = async (releases, repoHost, manifestRepo, deps) =>
  Promise.all(deps.map(async (d) => {
    if (!d.run_id || FINAL.has(d.status)) return d;
    try {
      const run = await repoHost.api(
        `/repos/${manifestRepo}/actions/runs/${d.run_id}`);
      const status = run.status === 'completed'
        ? (run.conclusion || 'failure') : (run.status || d.status);
      if (status === d.status && run.html_url === d.run_url) return d;
      return releases.upsertDeployment({
        release_id: d.release_id, environment: d.environment, status,
        run_id: d.run_id, run_url: run.html_url,
      });
    } catch { return d; }
  }));

export const getRelease = ({ releases, repoHost, manifestRepo }) =>
  async (number) => {
    const row = await releases.get(number);
    if (!row) return { status: 404, error: 'release not found' };
    const [gh, environments, deps] = await Promise.all([
      manifestRelease(repoHost, manifestRepo, row.version).catch(() => null),
      manifestEnvs(repoHost, manifestRepo, row.version).catch(() => []),
      releases.deployments(row.number),
    ]);
    const deployments = await refreshDeployments(
      releases, repoHost, manifestRepo, deps);
    return {
      status: 200,
      release: { ...decorate(row, gh), environments, deployments },
    };
  };

export const publishRelease = ({ releases, repoHost, manifestRepo }) =>
  async (number) => {
    const row = await releases.get(number);
    if (!row) return { status: 404, error: 'release not found' };
    const gh = await manifestRelease(repoHost, manifestRepo, row.version);
    if (!gh)
      return { status: 409, error: `no GitHub release v${row.version} on ${manifestRepo}` };
    if (!gh.draft) return { status: 200, release: decorate(row, gh) };
    const updated = await repoHost.api(
      `/repos/${manifestRepo}/releases/${gh.id}`,
      { method: 'PATCH', body: { draft: false } });
    return { status: 200, release: decorate(row, updated) };
  };

// Dispatch the manifest's deploy.yml for one environment. `release_no` is
// what unlocks `pro` in orch-deploy — production deploys only exist when
// the dashboard mints them.
export const deployRelease = ({ releases, repoHost, manifestRepo }) =>
  async (number, environment, actor) => {
    const row = await releases.get(number);
    if (!row) return { status: 404, error: 'release not found' };
    const env = String(environment || '').trim();
    if (!env) return { status: 400, error: 'environment required' };
    const gh = await manifestRelease(repoHost, manifestRepo, row.version);
    if (!gh || gh.draft)
      return { status: 409, error: `release v${row.version} is not published` };
    // Deployment window — outside it no environment can be deployed,
    // whatever state the release is in.
    if (row.deploy_start && Date.now() < Date.parse(row.deploy_start))
      return { status: 409, error: `deployment window opens at ${row.deploy_start}` };
    if (row.deploy_end && Date.now() > Date.parse(row.deploy_end))
      return { status: 409, error: `deployment window closed at ${row.deploy_end}` };

    await repoHost.api(
      `/repos/${manifestRepo}/actions/workflows/deploy.yml/dispatches`,
      {
        method: 'POST',
        body: {
          ref: 'main',
          inputs: {
            version: row.version, environment: env,
            release_no: releaseNo(row.number),
          },
        },
      });

    // The dispatched run takes a moment to appear — record it best-effort;
    // the row still tracks the request even if the run lookup misses.
    const since = new Date().toISOString();
    let run = null;
    try {
      const data = await repoHost.api(
        `/repos/${manifestRepo}/actions/workflows/deploy.yml/runs` +
        `?event=workflow_dispatch&per_page=5`);
      run = (data.workflow_runs || [])
        .find((r) => r.created_at >= since.slice(0, 16)) || data.workflow_runs?.[0];
    } catch { /* recorded without run link */ }
    const dep = await releases.upsertDeployment({
      release_id: row.number, environment: env,
      status: 'dispatched', run_id: run?.id ?? null,
      run_url: run?.html_url ?? null,
    });
    return { status: 202, deployment: dep };
  };
