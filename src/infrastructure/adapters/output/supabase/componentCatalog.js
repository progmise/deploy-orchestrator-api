// Output adapter: components table — the lifecycle registry.
// Implements the ComponentCatalog port (application/ports/output).
export const componentCatalog = ({ client }) => ({
  list: () => client.rest('components?select=*&order=created_at.desc'),

  async get(name) {
    const rows = await client.rest(`components?name=eq.${encodeURIComponent(name)}&select=*`);
    return rows[0] || null;
  },

  create: (row) =>
    client.rest('components', {
      method: 'POST',
      body: row,
      prefer: 'return=representation',
    }).then((rows) => rows[0]),

  update: (name, patch) =>
    client.rest(`components?name=eq.${encodeURIComponent(name)}`, {
      method: 'PATCH',
      body: patch,
      prefer: 'return=representation',
    }).then((rows) => rows?.[0] ?? null),

  // Append a provisioning step entry to provision_log and bump status.
  // `fields` persists step outputs that live in row columns (manifest_pr).
  async logStep(name, status, entry, fields = {}) {
    const row = await this.get(name);
    if (!row) throw new Error(`component ${name} not found`);
    return this.update(name, {
      status,
      ...fields,
      provision_log: [...row.provision_log, { at: new Date().toISOString(), ...entry }],
    });
  },
});
