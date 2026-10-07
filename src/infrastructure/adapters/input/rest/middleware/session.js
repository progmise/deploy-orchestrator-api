const COOKIE = 'gh_token';

export const readSessionCookie = (req) =>
  (req.headers.cookie || '').split(';').map((c) => c.trim())
    .find((c) => c.startsWith(`${COOKIE}=`))?.split('=')[1];

export const setSessionCookie = (res, token) =>
  res.setHeader('Set-Cookie',
    `${COOKIE}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=28800`);

export const clearSessionCookie = (res) =>
  res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; Path=/; Max-Age=0`);

// Resolves the session user from the token cookie; enforces the allowlist.
// Sends the response and returns null when unauthorized.
export const authedUser = ({ resolveSession }) => async (req, res) => {
  const session = await resolveSession(readSessionCookie(req));
  if (session.error === 'forbidden') {
    res.status(403).json({ error: 'not authorized' });
    return null;
  }
  if (!session.user) {
    const msg = session.error === 'unauthenticated' ? 'not authenticated' : 'bad token';
    res.status(401).json({ error: msg });
    return null;
  }
  return session;
};
