# AGENTS.md

Guide for working on **deploy-orchestrator-api** — the backend service of the
progmise deploy orchestrator (generated from `node-express-api-template`).

## Architecture

Hexagonal (ports & adapters), mirroring `java-maven-api-template` with
idiomatic JS (functions + duck-typed ports, no class ceremony):

```
src/
  index.js                    composition root — env → adapters → usecases → app
  app.js                      express wiring — middleware + routers
  config/env.js               every process.env read + config guards
  domain/                     pure rules (allowlist, component naming)
  application/
    ports/output/             contracts as JSDoc typedefs (IdentityProvider,
                              ComponentCatalog, CredentialStore, RepoHost)
    usecases/                 resolveSession, exchangeOAuthCode, listTemplates,
                              provisionComponent (state machine), createComponent
  infrastructure/
    adapters/input/rest/      routers + session middleware — HTTP <-> use cases
    adapters/output/          githubIdentity (OAuth), githubAdmin (provisioning
                              token), supabase/ (client, componentCatalog,
                              templateCatalog, platformConfigStore)
db/schema.sql                 templates + components + platform_vars tables,
                              Vault view — apply in the Supabase SQL editor.
```

- Dependencies point inward: routers never touch `fetch`/env directly; use
  cases never import express; domain imports nothing.
- The Vercel project is NOT created at provisioning time —
  `VERCEL_PROJECT_ID` ships empty and the deploy workflow provisions it
  lazily.
- Provisioning spec lives in `SPECS` (provisionComponent.js): which repo
  secrets/vars each template **kind** (`app`/`lib`) gets. The kind comes from
  the `templates` catalog row — not from naming conventions — and
  `components.template` is a FK to it. Master
  values live in the Supabase credential store (`platform_vars` +
  `vault.secrets`, read via the platformConfigStore adapter; process.env is
  only a fallback) — never exposed to the frontend.

- The SPA (`deploy-orchestrator`) proxies `/api/*` here — requests arrive
  same-origin, so there is **no CORS** and the session cookie stays
  `SameSite=Lax` + HttpOnly.
- `FRONTEND_URL` = the SPA origin: builds the OAuth `redirect_uri`
  (registered in the OAuth App as `<FRONTEND_URL>/api/auth/callback`) and
  the post-login/logout redirect.
- `ALLOWED_USERS` gates the callback AND every protected endpoint
  (`authedUser` re-fetches `/user` per request — revoking is immediate).
- `/api/manifest` and `/api/gh/*` require a session; `/api/health` is open.

## Conventions

- ESM, Express 5, no build step (`build` = `node --check src/index.js`).
- Single root `Dockerfile` — CSA scans it, Vercel builds it (preset
  `Container`); runtime strips npm.
- Secrets only via env (`GITHUB_CLIENT_*`); never log tokens.

## CI/CD

Thin callers → `progmise/reusable-workflows` `app-*` `@v1`.
`Setup → Build artifact → Build image → SAST ‖ SCA ‖ CSA → Tracing → Summary`;
release adds `Validate → CI → Publish Image → Release` — **never deploys**.

## Verify before done

```bash
npm ci && npm run build
PORT=8123 node src/index.js &   # /api/health → 200, /api/me → 401, /api/manifest → 401
```

## Branches

`main` (releases) + `development` (integration). Work lands on
`<type>/<snake_description>` → PR to `development` → PR to `main`.
