// Supabase PostgREST plumbing — shared by the catalog and credential-store
// adapters. Uses the service_role key: server-side only, never reaches the
// browser.
export const supabaseClient = ({ url, key }) => ({
  async rest(path, { method = 'GET', body, prefer } = {}) {
    const r = await fetch(`${url}/rest/v1/${path}`, {
      method,
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
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
  },
});
