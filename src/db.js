// Supabase PostgREST client — the components catalog.
// Uses the service_role key: server-side only, never reaches the browser.

const URL = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

export const dbReady = () => Boolean(URL && KEY);

async function rest(path, { method = 'GET', body, prefer } = {}) {
  const r = await fetch(`${URL}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      'Content-Type': 'application/json',
      ...(prefer ? { Prefer: prefer } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`supabase ${r.status}: ${text.slice(0, 300)}`);
  }
  return r.status === 204 ? null : r.json();
}

export const listComponents = () =>
  rest('components?select=*&order=created_at.desc');

export async function getComponent(name) {
  const rows = await rest(`components?name=eq.${encodeURIComponent(name)}&select=*`);
  return rows[0] || null;
}

export function createComponent(row) {
  return rest('components', {
    method: 'POST',
    body: row,
    prefer: 'return=representation',
  }).then((rows) => rows[0]);
}

export function updateComponent(name, patch) {
  return rest(`components?name=eq.${encodeURIComponent(name)}`, {
    method: 'PATCH',
    body: patch,
    prefer: 'return=representation',
  }).then((rows) => rows?.[0] ?? null);
}

// --- Platform credential store ----------------------------------------------
// Master copies of the values propagated to each generated repo:
//   platform_vars    — plain key/value (VERCEL_ORG_ID, DOCKER_USERNAME…)
//   platform_secrets — view over vault.decrypted_secrets (VERCEL_TOKEN…)
// Values are read per provisioning run; process.env acts as a local fallback
// for entries missing in the store.

export async function platformConfig() {
  const [vars, secrets] = await Promise.all([
    rest('platform_vars?select=key,value'),
    rest('platform_secrets?select=name,value'),
  ]);
  const cfg = Object.fromEntries(secrets.map((s) => [s.name, s.value]));
  for (const v of vars) cfg[v.key] = v.value;
  return cfg;
}

// --- API env bootstrap ------------------------------------------------------
// The API's own configuration lives in the DB too: plaintext keys in
// app_config, sensitive ones in the Vault (platform_secrets view). On boot,
// loadAppEnv hydrates process.env so the rest of the code reads env vars as
// usual. The DB is the master copy — a stored value overrides the env var;
// the env var only applies when the key is absent from the store (local dev).
// PORT stays env-only: the runtime injects it, it's platform config.

const APP_CONFIG_KEYS = [
  'GITHUB_CLIENT_ID',
  'ALLOWED_USERS',
  'FRONTEND_URL',
  'GITHUB_OWNER',
  'MANIFEST_REPO',
];
const APP_SECRET_KEYS = ['GITHUB_CLIENT_SECRET'];

export async function loadAppEnv() {
  if (!dbReady()) return;
  const keys = new Set([...APP_CONFIG_KEYS, ...APP_SECRET_KEYS]);
  const [vars, secrets] = await Promise.all([
    rest('app_config?select=key,value'),
    rest('platform_secrets?select=name,value'),
  ]);
  const all = [...vars, ...secrets.map((s) => ({ key: s.name, value: s.value }))];
  for (const { key, value } of all) if (keys.has(key)) process.env[key] = value;
}

// Append a provisioning step entry to provision_log and bump status.
// `fields` persists step outputs that live in row columns (e.g. manifest_pr).
export async function logStep(name, status, entry, fields = {}) {
  const row = await getComponent(name);
  if (!row) throw new Error(`component ${name} not found`);
  return updateComponent(name, {
    status,
    ...fields,
    provision_log: [...row.provision_log, { at: new Date().toISOString(), ...entry }],
  });
}
