// Output adapter: templates table — the registry of scaffolding sources the
// wizard can offer. GitHub `is_template` is still the generation mechanism;
// this catalog is the source of truth for what can be provisioned (kind,
// metadata) so kinds don't depend on repo naming conventions.
export const templateCatalog = ({ client }) => ({
  list: () => client.rest('templates?select=*&order=name'),

  async get(name) {
    const rows = await client.rest(`templates?name=eq.${encodeURIComponent(name)}&select=*`);
    return rows[0] || null;
  },
});
