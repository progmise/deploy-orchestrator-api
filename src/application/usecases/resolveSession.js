// Use case: cookie token → session. Returns { user, token } on success, or
// { error: 'unauthorized' | 'forbidden' } — the REST adapter maps those to
// 401/403. Access is granted by the ALLOWED_USERS env (bootstrap) OR a row
// in the members table (registered team member).
import { isAllowed } from '../../domain/allowlist.js';

export const resolveSession = ({ provider, allowedUsers, members }) =>
  async (token) => {
    if (!token) return { error: 'unauthenticated' };
    const user = await provider.getUser(token);
    if (!user) return { error: 'unauthorized' };
    if (!isAllowed(allowedUsers, user.login)
        && !(await members?.get(user.login).catch(() => null)))
      return { error: 'forbidden' };
    return { user, token };
  };
