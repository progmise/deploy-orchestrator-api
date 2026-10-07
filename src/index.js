import express from 'express';
import { createRequire } from 'node:module';
import { dbReady, listComponents, getComponent, createComponent, loadAppEnv } from './db.js';
import { listTemplates, provision, provisioningEnabled } from './provision.js';

const require = createRequire(import.meta.url);
const pkg = require('../package.json');

// Hydrate the API's own config from Supabase (app_config + Vault) before any
// process.env reads below. Soft-fail: without SUPABASE_* the process env is
// the only source, exactly as before.
try {
  await loadAppEnv();
} catch (e) {
  console.warn(`app config load failed: ${e.message}`);
}

const app = express();
app.use(express.json());
const PORT = process.env.PORT || 8080;
const CLIENT_ID = process.env.GITHUB_CLIENT_ID || '';
const CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET || '';
const COOKIE = 'gh_token';
// Comma-separated GitHub logins allowed to use the orchestrator.
// Empty = any authenticated GitHub user.
const ALLOWED = new Set(
  (process.env.ALLOWED_USERS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean));
// Origin of the dashboard SPA (separate service). Used for the OAuth
// redirect_uri — the OAuth App callback must be FRONTEND_URL/api/auth/callback —
// and for the post-login/logout redirects.
const FRONTEND_URL = (process.env.FRONTEND_URL || '').replace(/\/$/, '');

const baseUrl = (req) =>
  `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers['x-forwarded-host'] || req.headers.host}`;

const readCookie = (req) =>
  (req.headers.cookie || '').split(';').map((c) => c.trim())
    .find((c) => c.startsWith(`${COOKIE}=`))?.split('=')[1];

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

const allowed = (login) => !ALLOWED.size || ALLOWED.has(login.toLowerCase());

// Resolves the session user from the token cookie; enforces the allowlist.
// Returns { user, token } or sends the response and returns null.
async function authedUser(req, res) {
  const token = readCookie(req);
  if (!token) {
    res.status(401).json({ error: 'not authenticated' });
    return null;
  }
  const r = await ghFetch(token, 'https://api.github.com/user');
  if (!r.ok) {
    res.status(401).json({ error: 'bad token' });
    return null;
  }
  const user = await r.json();
  if (!allowed(user.login)) {
    res.status(403).json({ error: 'not authorized' });
    return null;
  }
  return { user, token };
}

// --- Auth (GitHub OAuth) ---------------------------------------------------

app.get('/api/auth/login', (req, res) => {
  const redirect = `${FRONTEND_URL || baseUrl(req)}/api/auth/callback`;
  res.redirect(
    `https://github.com/login/oauth/authorize?client_id=${CLIENT_ID}` +
    `&redirect_uri=${encodeURIComponent(redirect)}&scope=read:user`,
  );
});

app.get('/api/auth/callback', async (req, res) => {
  const r = await ghFetch(null, 'https://github.com/login/oauth/access_token', {
    method: 'POST',
    body: JSON.stringify({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      code: req.query.code,
    }),
  });
  const data = await r.json();
  if (!data.access_token) return res.status(401).send('OAuth failed');
  if (ALLOWED.size) {
    const u = await ghFetch(data.access_token, 'https://api.github.com/user');
    const user = u.ok ? await u.json() : null;
    if (!user || !allowed(user.login))
      return res.status(403).send('User not authorized');
  }
  res.setHeader('Set-Cookie',
    `${COOKIE}=${data.access_token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=28800`);
  res.redirect(`${FRONTEND_URL}/`);
});

app.get('/api/logout', (req, res) => {
  res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; Path=/; Max-Age=0`);
  res.redirect(`${FRONTEND_URL || '/'}`);
});

app.get('/api/me', async (req, res) => {
  const auth = await authedUser(req, res);
  if (!auth) return;
  const { user } = auth;
  res.json({ login: user.login, avatar_url: user.avatar_url });
});

// --- Data ------------------------------------------------------------------

// Proxy: /api/gh/<github api path>?<query> — uses the caller's own token.
app.get('/api/gh/{*splat}', async (req, res) => {
  const auth = await authedUser(req, res);
  if (!auth) return;
  const query = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
  const r = await ghFetch(auth.token,
    `https://api.github.com/${req.params.splat.join('/')}${query}`);
  res.status(r.status).json(await r.json().catch(() => ({})));
});

app.get('/api/manifest', async (req, res) => {
  if (!await authedUser(req, res)) return;
  const r = await fetch(
    'https://raw.githubusercontent.com/progmise/deploy-manifest/main/manifest.yml');
  res.type('text/yaml').send(await r.text());
});

// --- Component catalog & provisioning ---------------------------------------
// Supabase holds the lifecycle registry; deploy-manifest is its deployable
// projection (a registration PR lands when provisioning completes).

const catalogReady = (res) => {
  if (!dbReady()) {
    res.status(503).json({ error: 'component catalog not configured (SUPABASE_*)' });
    return false;
  }
  return true;
};

app.get('/api/templates', async (req, res) => {
  if (!await authedUser(req, res)) return;
  if (!provisioningEnabled())
    return res.status(503).json({ error: 'provisioning not configured (PROVISIONING_TOKEN)' });
  try {
    res.json(await listTemplates());
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) });
  }
});

app.get('/api/components', async (req, res) => {
  if (!await authedUser(req, res)) return;
  if (!catalogReady(res)) return;
  try {
    res.json(await listComponents());
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) });
  }
});

const NAME_RE = /^[a-z0-9][a-z0-9-]{0,38}[a-z0-9]$/;
const REPO_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/;

app.post('/api/components', async (req, res) => {
  const auth = await authedUser(req, res);
  if (!auth) return;
  if (!catalogReady(res)) return;
  if (!provisioningEnabled())
    return res.status(503).json({ error: 'provisioning not configured (PROVISIONING_TOKEN)' });

  const { name, repo, description = '', template } = req.body || {};
  if (!NAME_RE.test(name || ''))
    return res.status(400).json({ error: 'name must be lowercase letters, digits and hyphens' });
  if (!REPO_RE.test(repo || ''))
    return res.status(400).json({ error: 'repo must be a valid GitHub repository name' });

  let templates;
  try {
    templates = await listTemplates();
  } catch (e) {
    return res.status(502).json({ error: String(e.message || e) });
  }
  if (!templates.some((t) => t.name === template))
    return res.status(400).json({ error: `unknown template '${template}'` });
  if (await getComponent(name))
    return res.status(409).json({ error: `component '${name}' already exists` });

  const row = await createComponent({
    name,
    shortname: name.toUpperCase().replace(/[^A-Z0-9]/g, ''),
    repo: `${process.env.GITHUB_OWNER || 'progmise'}/${repo}`,
    description: String(description).slice(0, 500),
    template,
    created_by: auth.user.login,
  });

  try {
    res.status(201).json(await provision(row.name));
  } catch (e) {
    res.status(502).json({ error: String(e.message || e), component: await getComponent(name) });
  }
});

app.get('/api/components/:name', async (req, res) => {
  if (!await authedUser(req, res)) return;
  if (!catalogReady(res)) return;
  const row = await getComponent(req.params.name).catch(() => null);
  return row ? res.json(row) : res.status(404).json({ error: 'not found' });
});

// Re-runs the pending provisioning steps for a failed/pending component.
app.post('/api/components/:name/provision', async (req, res) => {
  if (!await authedUser(req, res)) return;
  if (!catalogReady(res)) return;
  if (!await getComponent(req.params.name))
    return res.status(404).json({ error: 'not found' });
  try {
    res.json(await provision(req.params.name));
  } catch (e) {
    res.status(502).json({ error: String(e.message || e), component: await getComponent(req.params.name) });
  }
});

app.get('/api/health', (_req, res) => res.json({ status: 'ok', version: pkg.version }));

// Unknown API routes return JSON 404.
app.use('/api', (_req, res) => res.status(404).json({ error: 'not found' }));

app.listen(PORT, () => console.log(`${pkg.name}:${pkg.version} on :${PORT}`));
