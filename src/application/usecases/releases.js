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
  async ({ version, description, planned_date, createdBy }) => {
    const v = String(version || '').trim();
    if (!SEMVER.test(v)) return { status: 400, error: 'version must be semver (x.y.z)' };
    if (!String(description || '').trim())
      return { status: 400, error: 'description required' };
    if (planned_date && Number.isNaN(Date.parse(planned_date)))
      return { status: 400, error: 'planned_date must be a date (YYYY-MM-DD)' };
    const release = await releases.create({
      version: v, description: description.trim(),
      planned_date: planned_date || null, created_by: createdBy || null,
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
