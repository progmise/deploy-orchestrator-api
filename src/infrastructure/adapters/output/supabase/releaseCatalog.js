// Output adapter: releases + release_deployments tables — the dashboard's
// release registry. Each row links an incremental RLSE number to a
// deploy-manifest release version; deployments track per-environment runs.
export const releaseCatalog = ({ client }) => ({
  list: () => client.rest('releases?select=*&order=number.desc'),

  async get(id) {
    const rows = await client.rest(`releases?id=eq.${id}&select=*`);
    return rows[0] || null;
  },

  create: (row) =>
    client.rest('releases', {
      method: 'POST',
      body: row,
      prefer: 'return=representation',
    }).then((rows) => rows[0]),

  deployments: (releaseId) =>
    client.rest(
      `release_deployments?release_id=eq.${releaseId}&select=*&order=environment`),

  upsertDeployment: (row) =>
    client.rest('release_deployments', {
      method: 'POST',
      body: row,
      prefer: 'return=representation,resolution=merge-duplicates',
    }).then((rows) => rows[0]),
});
