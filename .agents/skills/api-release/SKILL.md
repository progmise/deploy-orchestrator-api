---
name: api-release
description: Release this API — version bump, tag -> GitHub Actions -> Docker Hub image -> GitHub Release (deploy runs separately via Deploy/orchestrator)
argument-hint: "[change summary]"
allowed-tools:
  - read
  - edit
  - exec
  - grep
  - glob
permissions:
  allow:
    - Read(package.json)
    - Read(AGENTS.md)
  ask:
    - Write(package.json)
    - Exec(npm *)
    - Exec(git *)
---

# Skill: API Release

## Description
Drives a **release** of this service. Publishing is fully automated:
running the **Release** workflow (manual dispatch on `main`) validates the
version, runs the CI checks (incl. image build + scans), pushes the image to
Docker Hub (`:version` + `:latest`) and creates the git tag + GitHub Release.
It **never deploys** — Vercel deploys run through the **Deploy** workflow
(manual) or the `deploy-manifest` orchestrator.

## When to Use
- A change is ready to ship as a new deployed version.
- You need to redeploy an already-released version (use the **Deploy**
  workflow instead — no version bump needed).

## Preconditions
- For image publishing: var `DOCKER_USERNAME` + secret `DOCKER_TOKEN`
  (Publish Image is skipped without them — release still tags).
- For deploys later: secret `VERCEL_TOKEN` + vars `VERCEL_ORG_ID`,
  `VERCEL_PROJECT_ID`, `DEPLOY_ENVIRONMENTS` — see README *One-time setup*.
- Working tree green (`build-and-test` skill) before bumping.

---

## Step 1: Decide the version bump
- **Patch** (`x.y.+1`): fixes, dependency patches, docs.
- **Minor** (`x.+1.0`): backwards-compatible features/endpoints.
- **Major** (`+1.0.0`): contract-breaking changes — coordinate consumers.

Confirm the target version with the user.

## Step 2: Bump version
Edit `version` in `package.json` (and `CHANGELOG.md`). In the same change,
update `AGENTS.md`/`README` version references so docs stay in sync.

## Step 3: Build, test
`npm ci && npm run build && npm run lint` must be green. Optionally verify
the image build: `docker build -t test .`.

## Step 4: Commit & merge
```bash
git commit -m "<description>"
# PR → development → merge, then PR development → main → merge
```
`version` in `package.json` must already hold the release version on `main`.

## Step 5: Run the Release workflow
- Actions → **Release** → *Run workflow* on `main`. It validates the version
  (`--kind app`: fails if not on `main`, tag exists or SNAPSHOT), runs CI,
  publishes the image and creates the tag + GitHub Release.
  **It never deploys.**

## Step 6: Deploy
- Actions → **Deploy** → `version` + `environment` (`pro`/`cert`/`pre` —
  must be in `DEPLOY_ENVIRONMENTS`, default `["pro"]`), or bump the
  component tag in `deploy-manifest` and let the orchestrator deploy.
- Without `VERCEL_TOKEN`/`VERCEL_ORG_ID` the deploy job is skipped; on the
  first deploy `ensure-vercel-project.sh` creates the Vercel project and
  fills `VERCEL_PROJECT_ID` automatically.

## Step 7: Verify
- Image: `docker.io/<DOCKER_USERNAME>/<repo>:<version>` on Docker Hub.
- GitHub Release/tag `<version>` created.
- Vercel deployment URL in the deploy job summary; hit `/api/health`.
