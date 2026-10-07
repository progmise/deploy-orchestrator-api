// Component naming rules — the invariants the wizard/API enforce before a
// component exists anywhere else.
export const NAME_RE = /^[a-z0-9][a-z0-9-]{0,38}[a-z0-9]$/;
export const REPO_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/;

export const validComponentName = (name) => NAME_RE.test(name || '');
export const validRepoName = (repo) => REPO_RE.test(repo || '');

// Gluon-style shortname: uppercase alias, prefixes manifest infra ids
// (LOANSAPI → loans-api-pro style ci_ids).
export const shortnameFor = (name) => name.toUpperCase().replace(/[^A-Z0-9]/g, '');
