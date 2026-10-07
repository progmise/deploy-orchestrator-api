// Use case: cookie token → session. Returns { user, token } on success, or
// { error: 'unauthorized' | 'forbidden' } — the REST adapter maps those to
// 401/403.
import { isAllowed } from '../../domain/allowlist.js';

export const resolveSession = ({ provider, allowedUsers }) =>
  async (token) => {
    if (!token) return { error: 'unauthenticated' };
    const user = await provider.getUser(token);
    if (!user) return { error: 'unauthorized' };
    if (!isAllowed(allowedUsers, user.login)) return { error: 'forbidden' };
    return { user, token };
  };
