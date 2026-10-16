import { Router } from 'express';
import { authedUser } from '../middleware/session.js';

// Application secrets registry — backs the dashboard Seguridad view.
// Values are write-only: POST stores them in the Vault (audited), GET lists
// names only. Environment access is role-gated server-side (member roles).
export const secretsRouter = ({ usecases, catalogReady }) => {
  const auth = authedUser({ resolveSession: usecases.resolveSession });

  return Router()
    .get('/api/secrets', async (req, res) => {
      const session = await auth(req, res);
      if (!session) return;
      if (!catalogReady()) {
        return res.status(503).json({ error: 'credential store not configured (SUPABASE_*)' });
      }
      const result = await usecases.listSecrets({ environment: req.query.environment });
      res.status(result.status).json(result.error ? { error: result.error } : result);
    })

    .post('/api/secrets', async (req, res) => {
      const session = await auth(req, res);
      if (!session) return;
      if (!catalogReady()) {
        return res.status(503).json({ error: 'credential store not configured (SUPABASE_*)' });
      }
      const { name, environment, value } = req.body || {};
      const result = await usecases.upsertSecret({
        name, environment, value,
        member: session.member, actor: session.user.login,
      });
      res.status(result.status).json(result.error ? { error: result.error } : result);
    });
};
