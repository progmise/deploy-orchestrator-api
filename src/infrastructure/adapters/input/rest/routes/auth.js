import { Router } from 'express';
import { setSessionCookie, clearSessionCookie, authedUser }
  from '../middleware/session.js';

const baseUrl = (req) =>
  `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers['x-forwarded-host'] || req.headers.host}`;

// GitHub OAuth — the use cases carry the rules; this file only translates
// HTTP <-> application (statuses, cookie, redirects).
export const authRouter = ({ env, usecases }) => {
  const auth = authedUser({ resolveSession: usecases.resolveSession });
  return Router()
    .get('/api/auth/login', (req, res) => {
      const redirect = `${env.frontendUrl || baseUrl(req)}/api/auth/callback`;
      res.redirect(
        `https://github.com/login/oauth/authorize?client_id=${env.githubClientId}` +
        `&redirect_uri=${encodeURIComponent(redirect)}&scope=read:user`,
      );
    })

    .get('/api/auth/callback', async (req, res) => {
      const result = await usecases.exchangeOAuthCode(req.query.code);
      if (result.error === 'forbidden') return res.status(403).send('User not authorized');
      if (!result.token) return res.status(401).send('OAuth failed');
      setSessionCookie(res, result.token);
      res.redirect(`${env.frontendUrl}/`);
    })

    .get('/api/logout', (_req, res) => {
      clearSessionCookie(res);
      res.redirect(`${env.frontendUrl || '/'}`);
    })

    .get('/api/me', async (req, res) => {
      const session = await auth(req, res);
      if (!session) return;
      res.json({ login: session.user.login, avatar_url: session.user.avatar_url });
    });
};
