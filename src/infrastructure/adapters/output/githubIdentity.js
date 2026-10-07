// Output adapter: GitHub as identity provider.
// Implements the IdentityProvider port (application/ports/output).
const ghFetch = (token, url, opts = {}) =>
  fetch(url, {
    ...opts,
    headers: {
      Accept: 'application/vnd.github+json',
      ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...opts.headers,
    },
  });

export const githubIdentity = ({ clientId, clientSecret }) => ({
  async exchangeCode(code) {
    const r = await ghFetch(null, 'https://github.com/login/oauth/access_token', {
      method: 'POST',
      body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code }),
    });
    const data = await r.json().catch(() => ({}));
    return data.access_token || null;
  },

  async getUser(token) {
    const r = await ghFetch(token, 'https://api.github.com/user');
    return r.ok ? r.json() : null;
  },
});
