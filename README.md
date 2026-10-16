# deploy-orchestrator-api

Backend of the **progmise deploy orchestrator** — the API service behind
[`deploy-orchestrator`](https://github.com/progmise/deploy-orchestrator) (the SPA).
Generated from `node-express-api-template`.

## What it does

| Endpoint | Notes |
|---|---|
| `/api/auth/login` → `/api/auth/callback` | GitHub OAuth — `client_secret` never leaves the server; token goes into an HttpOnly `gh_token` cookie. `redirect_uri` = `FRONTEND_URL/api/auth/callback` (the SPA proxies it here) |
| `/api/me` | Session user + `secret_envs` (secret-writable envs by role) (`401` anon, `403` not in `ALLOWED_USERS`) |
| `/api/gh/*` | GitHub API proxy using the caller's own token |
| `/api/manifest` | `deploy-manifest` `manifest.yml` (session required) |
| `/api/templates` | Template catalog (Supabase): `GET` list, `POST` register — validates the repo (flips `is_template` or `/generate`s from a base template repo) + the `fields`/`spec` schema |
| `/api/platform/keys` | Credential key names for spec toggles (names only, never values) |
| `/api/components` | Component catalog (Supabase): `GET` list, `POST` create + provision |
| `/api/components/:name` | Component detail incl. `provision_log` |
| `/api/components/:name/provision` | `POST` re-runs pending provisioning steps (retry) |
| `/api/members` | Team registry: `GET` list, `POST` create (roles: developer, technical-lead, product-owner) |
| `/api/secrets` | Secret store: `GET ?env=` lists declared names + stored-name metadata (never values), `POST {name, env, value}` writes `NAME__ENV` into the credential store — role-gated (developers: cert/pre; technical-lead + product-owner: also pro), writes audited to `secret_events` |
| `/api/releases*` | RLSE registry: list/options/create/detail, `POST /:n/publish` (publishes the manifest draft), `POST /:n/deploy` (dispatches `deploy.yml` with `release_no`) |
| `/api/deployments` | `release_deployments` joined to releases (RLSE ↔ GitHub run) |
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
2. writes repo secrets/vars per the template's `spec` (`templates.spec`
   jsonb — self-describing; the hardcoded `SPECS` map is only a legacy
   fallback), with master values read from the **platform credential store** in
   Supabase — `vault.secrets` (encrypted) for secrets, `platform_vars` for
   variables (personal account, so no org-level secrets exist);
   `VERCEL_PROJECT_ID` is written **empty** — the deploy workflow creates the
   Vercel project lazily on first deploy and fills the var
   (`ensure-vercel-project.sh`),
3. opens a PR on `deploy-manifest` adding `components[]` + the
   `environments[].infrastructures[]` vercel entry (`lib` templates skip it —
   they publish to Central, not to a deploy target). `cm` (ConfigMap)
   templates register differently: no new infra — the component is added
   with `type: configmap`, bound to the `config.configures` app's infra
   ids, and the app's `needs:` gains the CM so its env vars deploy first.

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

Vercel container (preset `Container` + root `Dockerfile`), env vars
(Production): `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `ALLOWED_USERS`,
`FRONTEND_URL`, and for the catalog/provisioning endpoints
`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `PROVISIONING_TOKEN`,
`VERCEL_TOKEN`, `VERCEL_TEAM_ID`, `VERCEL_ORG_ID`, `DOCKER_USERNAME`,
`DOCKER_TOKEN`, `ORCHESTRATOR_TOKEN`, `DEPLOY_ENVIRONMENTS`
(see `.env.example`). Releases and deploys run through the `app-*` pipelines —
`Release` (tag + image) then `Deploy` (or the `deploy-manifest` orchestrator).
