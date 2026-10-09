import { Router } from 'express';
import { authedUser } from '../middleware/session.js';

// Team registry — any authenticated member can list and register members
// (roles gate *what* a member can do, not who can add people; revisit if
// we need admin-only alta).
export const membersRouter = ({ usecases, catalogReady }) => {
  const auth = authedUser({ resolveSession: usecases.resolveSession });

  return Router()
    .get('/api/members', async (req, res) => {
      if (!await auth(req, res)) return;
      if (!catalogReady()) {
        return res.status(503).json({ error: 'member catalog not configured (SUPABASE_*)' });
      }
      try {
        res.json(await usecases.listMembers());
      } catch (e) {
        res.status(502).json({ error: String(e.message || e) });
      }
    })

    .post('/api/members', async (req, res) => {
      const session = await auth(req, res);
      if (!session) return;
      if (!catalogReady()) {
        return res.status(503).json({ error: 'member catalog not configured (SUPABASE_*)' });
      }
      const { github_username, full_name, email, roles } = req.body || {};
      const result = await usecases.createMember({
        github_username, full_name, email, roles, createdBy: session.user.login,
      });
      res.status(result.status).json(result.member ?? { error: result.error });
    });
};
