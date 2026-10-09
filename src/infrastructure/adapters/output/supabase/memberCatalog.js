// Output adapter: members table — the team registry. Membership also gates
// the session allowlist (a registered member may log in even if not in the
// ALLOWED_USERS env — the env stays as the bootstrap).
export const memberCatalog = ({ client }) => ({
  list: () => client.rest('members?select=*&order=created_at.desc'),

  async get(username) {
    const rows = await client.rest(
      `members?github_username=eq.${encodeURIComponent(username.toLowerCase())}&select=*`);
    return rows[0] || null;
  },

  create: (row) =>
    client.rest('members', {
      method: 'POST',
      body: row,
      prefer: 'return=representation',
    }).then((rows) => rows[0]),
});
