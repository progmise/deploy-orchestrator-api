// Output port: repository host contract — the admin-level GitHub access the
// provisioner needs (template generation, branches, secrets/vars, manifest
// PR). Implemented by infrastructure/adapters/output/githubAdmin.js.

/**
 * @typedef {object} RepoHost
 * @property {(path: string, opts?: {method?: string, body?: object}) => Promise<any>} api
 *   Authenticated GitHub REST call (provisioning token). `path` starts with
 *   '/repos/…' or similar; throws on non-2xx with `github <METHOD> <path> → <status>`.
 * @property {string} owner         account that owns the repos (e.g. progmise)
 * @property {string} manifestRepo  full coordinates of the manifest repo
 */
