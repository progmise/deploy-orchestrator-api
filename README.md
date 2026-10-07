# deploy-orchestrator-api

Backend of the **progmise deploy orchestrator** — the API service behind
[`deploy-orchestrator`](https://github.com/progmise/deploy-orchestrator) (the SPA).
Generated from `node-express-api-template`.

## What it does

| Endpoint | Notes |
|---|---|
| `/api/auth/login` → `/api/auth/callback` | GitHub OAuth — `client_secret` never leaves the server; token goes into an HttpOnly `gh_token` cookie. `redirect_uri` = `FRONTEND_URL/api/auth/callback` (the SPA proxies it here) |
| `/api/me` | Session user (`401` anon, `403` not in `ALLOWED_USERS`) |
| `/api/gh/*` | GitHub API proxy using the caller's own token |
| `/api/manifest` | `deploy-manifest` `manifest.yml` (session required) |
| `/api/templates` | `progmise` repos flagged `is_template` |
| `/api/components` | Component catalog (Supabase): `GET` list, `POST` create + provision |
| `/api/components/:name` | Component detail incl. `provision_log` |
| `/api/components/:name/provision` | `POST` re-runs pending provisioning steps (retry) |
| `/api/health` | Liveness |

Access is gated by `ALLOWED_USERS` (comma-separated GitHub logins),
re-checked on every request — removing a login cuts access immediately.
The SPA reaches this service through a same-origin `/api/*` proxy on the
frontend, so **no CORS is needed** and the cookie stays `SameSite=Lax`.

## Component provisioning

`POST /api/components {name, repo, description, template}` registers a row in
the Supabase `components` table (`db/schema.sql`) and runs the state machine:

```
pending → repo_created → secrets_written → vars_written
        → manifest_pr_opened → ready
        (any failure → 'failed', resumable via /provision)
```

1. generates `progmise/<repo>` from the GitHub template and ensures
   `main` + `development` branches (default: `development`),
2. writes repo secrets/vars read from the **platform credential store** in
   Supabase — `vault.secrets` (encrypted) for secrets, `platform_vars` for
   variables (personal account, so no org-level secrets exist);
   `VERCEL_PROJECT_ID` is written **empty** — the deploy workflow creates the
   Vercel project lazily on first deploy and fills the var
   (`ensure-vercel-project.sh`),
3. opens a PR on `deploy-manifest` adding `components[]` + the
   `environments[].infrastructures[]` vercel entry (`lib` templates skip it —
   they publish to Central, not to a deploy target).

Seed the store in the Supabase SQL editor:

```sql
select vault.create_secret('<value>', 'VERCEL_TOKEN');       -- DOCKER_TOKEN, ORCHESTRATOR_TOKEN…
insert into public.platform_vars (key, value) values
  ('VERCEL_ORG_ID', 'team_xxx'),
  ('DOCKER_USERNAME', 'progmise'),
  ('DEPLOY_ENVIRONMENTS', '["pro"]');
```

Each step is idempotent and logged in `provision_log` — a failed component
retries from the last completed status, so partial provisioning is visible
and recoverable from the dashboard.

## Deploy

Vercel container (preset `Container` + root `Dockerfile`). The only env vars
the service truly needs (Production) are the bootstrap pair:

- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`

On boot, `loadAppEnv()` hydrates `process.env` from the DB itself — the API
is its own config store:

| Key | Where |
|---|---|
| `GITHUB_CLIENT_ID`, `ALLOWED_USERS`, `FRONTEND_URL`, `GITHUB_OWNER`, `MANIFEST_REPO` | `public.app_config` |
| `GITHUB_CLIENT_SECRET`, `PROVISIONING_TOKEN` | `vault.secrets` |
| propagated credentials (`VERCEL_*`, `DOCKER_*`, `ORCHESTRATOR_TOKEN`, `SONATYPE_*`, `GPG_*`) | `vault.secrets` + `platform_vars` |

A real env var still works as a local fallback for keys absent from the DB
(see `.env.example`); `PORT` is always env — the runtime injects it.

```sql
insert into public.app_config (key, value) values
  ('GITHUB_CLIENT_ID', 'Ov23…'),
  ('ALLOWED_USERS', 'progmise'),
  ('FRONTEND_URL', 'https://deploy-orchestrator.vercel.app'),
  ('GITHUB_OWNER', 'progmise'),
  ('MANIFEST_REPO', 'progmise/deploy-manifest');
select vault.create_secret('<oauth-secret>', 'GITHUB_CLIENT_SECRET');
select vault.create_secret('<pat>', 'PROVISIONING_TOKEN');
```

Releases and deploys run through the `app-*` pipelines — `Release` (tag +
image) then `Deploy` (or the `deploy-manifest` orchestrator).
