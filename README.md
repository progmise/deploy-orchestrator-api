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
pending → repo_created → secrets_written → vercel_project_created
        → vars_written → manifest_pr_opened → ready
        (any failure → 'failed', resumable via /provision)
```

1. generates `progmise/<repo>` from the GitHub template and ensures
   `main` + `development` branches (default: `development`),
2. writes repo secrets/vars from this service's env (the credential store —
   personal account, so no org-level secrets exist),
3. creates the Vercel project (`app` templates; `lib` skips infra steps),
4. opens a PR on `deploy-manifest` adding `components[]` + the
   `environments[].infrastructures[]` vercel entry.

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
