// Use case: application secrets registry (the Seguridad view).
//
// Values live in the platform credential store (Supabase Vault) under keys
// `<NAME>__<ENV>` — the dashboard Seguridad view is the only write path.
// Secrets components' deploy workflows resolve those keys to values and
// upsert them as `sensitive` env vars on the target Vercel project.
//
// Role gate — which environments a member can write:
//   developer                        → cert, pre
//   technical-lead | product-owner   → cert, pre, pro
// No member row (bootstrap ALLOWED_USERS) → all environments.
const ENVIRONMENTS = ['cert', 'pre', 'pro'];
const PRO_ROLES = new Set(['technical-lead', 'product-owner']);

const NAME_RE = /^[A-Z_][A-Z0-9_]*$/;

export const allowedEnvironments = (member) => {
  if (!member) return ENVIRONMENTS;               // bootstrap allowlist user
  return (member.roles || []).some((r) => PRO_ROLES.has(r))
    ? ENVIRONMENTS
    : ['cert', 'pre'];
};

export const listSecrets = ({ store }) =>
  async ({ environment }) => {
    const env = String(environment || '').toLowerCase();
    if (!ENVIRONMENTS.includes(env))
      return { status: 400, error: `environment must be one of ${ENVIRONMENTS.join('/')}` };
    const names = await store.secretNames(env);
    // Names only — values are write-only, never returned.
    return { status: 200, environment: env, secrets: names.map((name) => ({ name })) };
  };

export const upsertSecret = ({ store }) =>
  async ({ name, environment, value, member, actor }) => {
    const env = String(environment || '').toLowerCase();
    if (!ENVIRONMENTS.includes(env))
      return { status: 400, error: `environment must be one of ${ENVIRONMENTS.join('/')}` };
    if (!allowedEnvironments(member).includes(env))
      return { status: 403, error: `role does not allow writing '${env}' secrets` };
    const n = String(name || '').trim().toUpperCase();
    if (!NAME_RE.test(n))
      return { status: 400, error: 'name must be env-var style (e.g. REDIS_PASSWORD)' };
    if (!String(value || ''))
      return { status: 400, error: 'value is required' };
    await store.putSecret(`${n}__${env.toUpperCase()}`, String(value), { actor });
    // Never echo the value back — return the audit shape only.
    return { status: 200, secret: { name: n, environment: env } };
  };
