// Output port: platform credential store contract — master copies of the
// secrets/vars propagated into each generated repo.
// Implemented by infrastructure/adapters/output/supabase/platformConfigStore.js
// (platform_vars table + Vault via the platform_secrets view).

/**
 * @typedef {object} CredentialStore
 * @property {() => Promise<Record<string, string>>} all
 *   Every stored value keyed by name — secrets and vars merged. Never leaves
 *   the server; entries may be missing (env vars are the fallback).
 */
