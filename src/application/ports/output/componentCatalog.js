// Output port: component catalog contract — the persistent lifecycle
// registry (Supabase `components` table).
// Implemented by infrastructure/adapters/output/supabase/componentCatalog.js.

/**
 * @typedef {object} Component
 * @property {string} name          PK — lands in deploy-manifest components[].name
 * @property {string} shortname     uppercase/digit alias, prefixes infra ids
 * @property {string} repo          full coordinates, e.g. progmise/loans-api
 * @property {string} description
 * @property {string} template      template repo it was generated from
 * @property {string} status        pending|repo_created|secrets_written|
 *                                  vars_written|manifest_pr_opened|ready|failed
 * @property {number|null} manifest_pr
 * @property {Array}  provision_log
 * @property {string} created_by    GitHub login
 */

/**
 * @typedef {object} ComponentCatalog
 * @property {() => Promise<Component[]>} list
 * @property {(name: string) => Promise<Component|null>} get
 * @property {(row: object) => Promise<Component>} create
 * @property {(name: string, patch: object) => Promise<Component|null>} update
 * @property {(name: string, status: string, entry: object, fields?: object) => Promise<Component>}
 *   logStep — append a provision_log entry and bump status/columns.
 */
