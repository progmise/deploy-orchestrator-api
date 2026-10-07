// Single place that reads process.env — resolved once at import time and
// treated as immutable config. New vars go here + .env.example (no values).
export const env = {
  port: process.env.PORT || 8080,
  githubClientId: process.env.GITHUB_CLIENT_ID || '',
  githubClientSecret: process.env.GITHUB_CLIENT_SECRET || '',
  // Comma-separated GitHub logins allowed to use the orchestrator.
  // Empty = any authenticated GitHub user.
  allowedUsers: new Set(
    (process.env.ALLOWED_USERS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)),
  // SPA origin — OAuth redirect_uri + post-login/logout redirects.
  frontendUrl: (process.env.FRONTEND_URL || '').replace(/\/$/, ''),

  // Supabase catalog + credential store (service_role, server-side only).
  supabaseUrl: (process.env.SUPABASE_URL || '').replace(/\/$/, ''),
  supabaseServiceKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',

  // Provisioning (fine-grained PAT + repo coordinates).
  provisioningToken: process.env.PROVISIONING_TOKEN || '',
  githubOwner: process.env.GITHUB_OWNER || 'progmise',
  manifestRepo: process.env.MANIFEST_REPO || 'progmise/deploy-manifest',
};

export const catalogReady = () => Boolean(env.supabaseUrl && env.supabaseServiceKey);
export const provisioningEnabled = () => Boolean(env.provisioningToken);
