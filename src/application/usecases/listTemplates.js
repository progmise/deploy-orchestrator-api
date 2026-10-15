import { specFor } from './provisionComponent.js';

// Use case: list the registered templates — the catalog is the source of
// truth (kind drives the provisioning spec; GitHub `is_template` is only the
// generation mechanism, verified by the provisioner).
export const listTemplates = ({ templates }) =>
  async () => templates.list();

const TEMPLATE_NAME_RE = /^[a-z0-9][a-z0-9-]{1,60}[a-z0-9]$/;
const FIELD_KEY_RE = /^[a-z][a-z0-9_]{0,30}$/;
const FIELD_TYPES = ['select', 'fixed'];

// Registers an existing GitHub repo as a provisioning template. The repo
// must exist under the admin token's reach; if it isn't marked
// `is_template` yet, the admin token flips it (same permission as
// generation). `fields` declares the wizard "Personalización" schema.
export const createTemplate = ({ templates, repoHost }) =>
  async ({ name, repo, kind, display_name, description, fields }) => {
    const n = String(name || '').trim();
    if (!TEMPLATE_NAME_RE.test(n))
      return { status: 400, error: 'name must be kebab-case (e.g. node-express-api-template)' };
    const r = String(repo || '').trim();
    if (!/^[\w.-]+\/[\w.-]+$/.test(r))
      return { status: 400, error: 'repo must be owner/name (e.g. progmise/node-express-api-template)' };
    if (!specFor(kind))
      return { status: 400, error: `kind must be one of app|lib` };
    if (await templates.get(n))
      return { status: 409, error: `template '${n}' already exists` };

    const fs = Array.isArray(fields) ? fields : [];
    for (const f of fs) {
      if (!FIELD_KEY_RE.test(f?.key || '') || !String(f?.label || '').trim())
        return { status: 400, error: 'each field needs a snake_case key and a label' };
      if (!FIELD_TYPES.includes(f.type))
        return { status: 400, error: `field '${f.key}' type must be select|fixed` };
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

    // Verify the repo exists and is template-enabled — flip it if the
    // admin token can.
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
    });
    return { status: 201, template };
  };
