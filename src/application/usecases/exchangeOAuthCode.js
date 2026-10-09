// Use case: OAuth code → session token, gated by the allowlist.
// Returns { token }, or { error: 'unauthorized' | 'forbidden' }.
import { isAllowed } from '../../domain/allowlist.js';

export const exchangeOAuthCode = ({ provider, allowedUsers, members }) =>
  async (code) => {
    const token = await provider.exchangeCode(code);
    if (!token) return { error: 'unauthorized' };
    if (allowedUsers.size || members) {
      const user = await provider.getUser(token);
      const member = await members?.get(user?.login || '').catch(() => null);
      if ((!user || !isAllowed(allowedUsers, user.login)) && !member)
        return { error: 'forbidden' };
    }
    return { token };
  };
