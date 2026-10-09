// Use cases: team registry. createMember validates the payload, verifies the
// GitHub account exists (repoHost), and registers the member — registration
// is what grants login access (see resolveSession).
export const MEMBER_ROLES = ['developer', 'technical-lead'];

const GH_USER_RE = /^[a-zA-Z0-9](?:-?[a-zA-Z0-9]){0,38}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const createMember = ({ members, repoHost }) =>
  async ({ github_username, full_name, email, roles = ['developer'], createdBy }) => {
    const username = String(github_username || '').trim().toLowerCase();
    if (!GH_USER_RE.test(username)) return { status: 400, error: 'invalid github_username' };
    if (!String(full_name || '').trim()) return { status: 400, error: 'full_name required' };
    if (!EMAIL_RE.test(String(email || ''))) return { status: 400, error: 'invalid email' };
    if (!Array.isArray(roles) || !roles.length || roles.some((r) => !MEMBER_ROLES.includes(r)))
      return { status: 400, error: `roles must be non-empty subset of ${MEMBER_ROLES.join('/')}` };
    if (await members.get(username)) return { status: 409, error: 'member already registered' };

    if (repoHost) {
      const exists = await repoHost.api(`/users/${username}`).then(() => true).catch(() => false);
      if (!exists) return { status: 400, error: `github user ${username} does not exist` };
    }
    const member = await members.create({
      github_username: username, full_name: full_name.trim(), email: email.trim(),
      roles, created_by: createdBy || null,
    });
    return { status: 201, member };
  };
