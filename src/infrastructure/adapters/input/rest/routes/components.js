import { Router } from 'express';
import { authedUser } from '../middleware/session.js';

// Component catalog & provisioning — Supabase holds the lifecycle registry;
// deploy-manifest is its deployable projection (a registration PR lands
// when provisioning completes).
export const componentsRouter = ({ usecases, catalogReady, provisioningEnabled }) => {
  const auth = authedUser({ resolveSession: usecases.resolveSession });
  const catalogOk = (res) => {
    if (!catalogReady()) {
      res.status(503).json({ error: 'component catalog not configured (SUPABASE_*)' });
      return false;
    }
    return true;
  };
  const provisioningOk = (res) => {
    if (!provisioningEnabled()) {
      res.status(503).json({ error: 'provisioning not configured (PROVISIONING_TOKEN)' });
      return false;
    }
    return true;
  };

  return Router()
    .get('/api/templates', async (req, res) => {
      if (!await auth(req, res)) return;
      if (!provisioningOk(res)) return;
      try {
        res.json(await usecases.listTemplates());
      } catch (e) {
        res.status(502).json({ error: String(e.message || e) });
      }
    })

    .get('/api/components', async (req, res) => {
      if (!await auth(req, res)) return;
      if (!catalogOk(res)) return;
      try {
        res.json(await usecases.listComponents());
      } catch (e) {
        res.status(502).json({ error: String(e.message || e) });
      }
    })

    .post('/api/components', async (req, res) => {
      const session = await auth(req, res);
      if (!session) return;
      if (!catalogOk(res)) return;
      if (!provisioningOk(res)) return;
      const { name, shortname, repo, description = '', template, config } = req.body || {};
      const result = await usecases.createComponent({
        name, shortname, repo, description, template, config, createdBy: session.user.login,
      });
      const { status, ...body } = result;
      res.status(status).json(result.component ?? body);
    })

    .get('/api/components/:name', async (req, res) => {
      if (!await auth(req, res)) return;
      if (!catalogOk(res)) return;
      const row = await usecases.getComponent(req.params.name).catch(() => null);
      return row ? res.json(row) : res.status(404).json({ error: 'not found' });
    })

    // Re-runs the pending provisioning steps for a failed/pending component.
    .post('/api/components/:name/provision', async (req, res) => {
      if (!await auth(req, res)) return;
      if (!catalogOk(res)) return;
      if (!await usecases.getComponent(req.params.name))
        return res.status(404).json({ error: 'not found' });
      try {
        res.json(await usecases.provision(req.params.name));
      } catch (e) {
        res.status(502).json({ error: String(e.message || e), component: await usecases.getComponent(req.params.name) });
      }
    });
};
