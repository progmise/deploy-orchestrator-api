// Component naming rules — the invariants the wizard/API enforce before a
// component exists anywhere else.
export const NAME_RE = /^[a-z0-9][a-z0-9-]{0,38}[a-z0-9]$/;
export const REPO_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/;
export const SHORTNAME_RE = /^[A-Z0-9]{2,30}$/;
export const BRANCH_STRATEGIES = ['gitflow', 'trunk'];

export const validComponentName = (name) => NAME_RE.test(name || '');
export const validRepoName = (repo) => REPO_RE.test(repo || '');
export const validShortname = (s) => SHORTNAME_RE.test(s || '');

// Gluon-style shortname: uppercase alias, prefixes manifest infra ids
// (LOANSAPI → loans-api-pro style ci_ids). The wizard pre-fills this and
// lets the user override it.
export const shortnameFor = (name) => name.toUpperCase().replace(/[^A-Z0-9]/g, '');

// Resolves the "Personalización" answers against the template's declared
// fields — fixed fields take their declared value, selects must match an
// option (or fall back to the declared default). Unknown keys are dropped.
export const resolveConfig = (fields = [], answers = {}) => {
  const config = {};
  for (const f of fields) {
    if (f.type === 'fixed') { config[f.key] = f.value; continue; }
    const v = answers[f.key];
    config[f.key] = (f.options || []).some((o) => o.value === v) ? v : f.default;
  }
  return config;
};
