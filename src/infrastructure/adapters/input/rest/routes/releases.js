import { Router } from 'express';
import { authedUser } from '../middleware/session.js';

// Release registry — authenticated members manage RLSE records; publish and
// deploy run through repoHost (admin token), so GitHub itself never gets a
// manual publish and `pro` deploys only exist via this endpoint.
export const releasesRouter = ({ usecases, catalogReady }) => {
  const auth = authedUser({ resolveSession: usecases.resolveSession });
  const guard = (req, res) => catalogReady()
    ? null : res.status(503).json({ error: 'release catalog not configured (SUPABASE_*)' });

  return Router()
    .get('/api/releases', async (req, res) => {
      if (!await auth(req, res)) return;
      if (guard(req, res)) return;
      try {
        res.json(await usecases.listReleases());
      } catch (e) {
        res.status(502).json({ error: String(e.message || e) });
      }
    })

    .post('/api/releases', async (req, res) => {
      const session = await auth(req, res);
      if (!session) return;
      if (guard(req, res)) return;
      const { version, description, planned_date, trail, deploy_start,
        deploy_end, reason, product_owner, requested_by, priority, risk,
        details, impact, justification, deploy_plan, risk_analysis,
        test_plan, recovery_plan } = req.body || {};
      const result = await usecases.createRelease({
        version, description, planned_date, trail, deploy_start,
        deploy_end, reason, product_owner, requested_by, priority, risk,
        details, impact, justification, deploy_plan, risk_analysis,
        test_plan, recovery_plan, createdBy: session.user.login,
      });
      res.status(result.status).json(result.release ?? { error: result.error });
    })

    // Before /:number so "options" isn't parsed as a release number.
    .get('/api/releases/options', async (req, res) => {
      if (!await auth(req, res)) return;
      try {
        res.json(await usecases.releaseOptions());
      } catch (e) {
        res.status(502).json({ error: String(e.message || e) });
      }
    })

    .get('/api/releases/:number', async (req, res) => {
      if (!await auth(req, res)) return;
      if (guard(req, res)) return;
      try {
        const result = await usecases.getRelease(req.params.number);
        res.status(result.status).json(result.release ?? { error: result.error });
      } catch (e) {
        res.status(502).json({ error: String(e.message || e) });
      }
    })

    .post('/api/releases/:number/publish', async (req, res) => {
      if (!await auth(req, res)) return;
      if (guard(req, res)) return;
      try {
        const result = await usecases.publishRelease(req.params.number);
        res.status(result.status).json(result.release ?? { error: result.error });
      } catch (e) {
        res.status(502).json({ error: String(e.message || e) });
      }
    })

    .post('/api/releases/:number/deploy', async (req, res) => {
      const session = await auth(req, res);
      if (!session) return;
      if (guard(req, res)) return;
      try {
        const result = await usecases.deployRelease(
          req.params.number, req.body?.environment, session.user.login);
        res.status(result.status)
          .json(result.deployment ?? { error: result.error });
      } catch (e) {
        res.status(502).json({ error: String(e.message || e) });
      }
    });
};
