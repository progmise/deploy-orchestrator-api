import { specFor } from './provisionComponent.js';

// Use case: list the registered templates — the catalog is the source of
// truth (kind drives the provisioning spec; GitHub `is_template` is only the
// generation mechanism, verified by the provisioner).
export const listTemplates = ({ templates }) =>
  async () => templates.list();

const TEMPLATE_NAME_RE = /^[a-z0-9][a-z0-9-]{1,60}[a-z0-9]$/;
const FIELD_KEY_RE = /^[a-z][a-z0-9_]{0,30}$/;
// 'component' selects another catalog component by name — options are
// resolved dynamically at wizard time (e.g. `configures` on CM templates).
const FIELD_TYPES = ['select', 'fixed', 'component'];

// Registers a provisioning template. Two repo modes:
//   existing — `repo` must exist; is_template gets flipped if needed
//   generate_from — the repo is created from a base template repo
// `fields` declares the wizard "Personalización" schema; `spec` declares
// what the provisioner writes into generated repos (self-describing —
// secrets/vars names must exist in the platform credential store).
export const createTemplate = ({ templates, repoHost, store }) =>
  async ({ name, repo, kind, display_name, description, fields, spec,
    generate_from }) => {
    const n = String(name || '').trim();
    if (!TEMPLATE_NAME_RE.test(n))
      return { status: 400, error: 'name must be kebab-case (e.g. node-express-api-template)' };
    const r = String(repo || '').trim();
    if (!/^[\w.-]+\/[\w.-]+$/.test(r))
      return { status: 400, error: 'repo must be owner/name (e.g. progmise/node-express-api-template)' };
    if (!specFor(kind))
      return { status: 400, error: `kind must be one of app|lib|cm` };
    if (await templates.get(n))
      return { status: 409, error: `template '${n}' already exists` };

    const fs = Array.isArray(fields) ? fields : [];
    for (const f of fs) {
      if (!FIELD_KEY_RE.test(f?.key || '') || !String(f?.label || '').trim())
        return { status: 400, error: 'each field needs a snake_case key and a label' };
      if (!FIELD_TYPES.includes(f.type))
        return { status: 400, error: `field '${f.key}' type must be select|fixed|component` };
      if (f.type === 'fixed' && f.value === undefined)
        return { status: 400, error: `field '${f.key}' (fixed) needs a value` };
      if (f.type === 'select') {
        const opts = Array.isArray(f.options) ? f.options : [];
        if (!opts.length || opts.some((o) => !o?.value))
          return { status: 400, error: `field '${f.key}' (select) needs options` };
        if (f.default !== undefined && !opts.some((o) => o.value === f.default))
          return { status: 400, error: `field '${f.key}' default must be one of its options` };
      }
    }

    // spec validation — every referenced credential name must exist in the
    // store (VERCEL_PROJECT_ID is a lazy placeholder, allowed regardless).
    const s = spec && Array.isArray(spec.secrets) && Array.isArray(spec.vars)
      ? spec : null;
    if (spec && !s)
      return { status: 400, error: 'spec must be {secrets: [], vars: [], manifest: bool}' };
    if (s) {
      const known = await store.keys();
      const missingSecrets = s.secrets.filter((k) => !known.secrets.includes(k));
      const missingVars = s.vars.filter((k) =>
        !known.vars.includes(k) && k !== 'VERCEL_PROJECT_ID');
      if (missingSecrets.length || missingVars.length)
        return { status: 400, error: `unknown credential names: ${[...missingSecrets, ...missingVars].join(', ')}` };
    }

    // Repo — either verified/flipped (existing) or generated from a base
    // template repo and template-enabled.
    if (generate_from) {
      const b = String(generate_from).trim();
      const base = await repoHost.api(`/repos/${b}`).catch(() => null);
      if (!base?.is_template)
        return { status: 422, error: `${b} is not a template repo` };
      const [owner, repoName] = r.split('/');
      const gen = await repoHost.api(`/repos/${b}/generate`, {
        method: 'POST',
        body: { owner, name: repoName, description: description || '',
          private: false, include_all_branches: false },
      }).catch((e) => ({ __err: String(e.message || e) }));
      if (gen.__err) return { status: 502, error: `repo generation failed: ${gen.__err}` };
    }
    const ghRepo = await repoHost.api(`/repos/${r}`).catch(() => null);
    if (!ghRepo) return { status: 404, error: `repo ${r} not found or unreachable` };
    if (!ghRepo.is_template) {
      const patched = await repoHost.api(`/repos/${r}`, {
        method: 'PATCH', body: { is_template: true },
      }).catch(() => null);
      if (!patched?.is_template)
        return { status: 422, error: `${r} is not a template repo and could not be marked as one` };
    }

    const template = await templates.create({
      name: n, repo: r, kind,
      display_name: String(display_name || '').trim(),
      description: String(description || '').trim(),
      fields: fs,
      spec: s || specFor(kind),
    });
    return { status: 201, template };
  };
