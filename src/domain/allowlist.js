// Domain rule: the allowlist gates who may hold a session. An empty set
// means open — any authenticated GitHub user.
export const isAllowed = (allowedUsers, login) =>
  !allowedUsers.size || allowedUsers.has(login.toLowerCase());
