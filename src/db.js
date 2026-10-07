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

// Append a provisioning step entry to provision_log and bump status.
// `fields` persists step outputs that live in row columns (vercel_project_id…).
export async function logStep(name, status, entry, fields = {}) {
  const row = await getComponent(name);
  if (!row) throw new Error(`component ${name} not found`);
  return updateComponent(name, {
    status,
    ...fields,
    provision_log: [...row.provision_log, { at: new Date().toISOString(), ...entry }],
  });
}
