// Output adapter: GitHub REST with the provisioning token.
// Implements the RepoHost port — admin-level operations: generate a repo
// from a template, create branches, write secrets/variables, open the
// manifest registration PR.
export const githubAdmin = ({ token, owner, manifestRepo }) => ({
  owner,
  manifestRepo,

  async api(path, { method = 'GET', body } = {}) {
    const r = await fetch(`https://api.github.com${path}`, {
      method,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok)
      throw new Error(`github ${method} ${path} → ${r.status}: ${data.message || ''}`.trim());
    return data;
  },
});
