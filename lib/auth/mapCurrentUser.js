import Cookies from 'js-cookie';

const INVALID_NAME_TOKENS = new Set(['na', 'n/a', 'null', 'undefined', '-']);

export function sanitizeNameValue(value) {
  if (!value) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  return INVALID_NAME_TOKENS.has(trimmed.toLowerCase()) ? null : trimmed;
}

function getTechnician(bootstrapUser) {
  if (!bootstrapUser) return null;
  return bootstrapUser.technicians?.[0] || bootstrapUser.technicians || null;
}

/**
 * Slim identity for API payloads and permission checks.
 */
export function mapBootstrapUserToCurrentUser(bootstrapUser) {
  const technician = getTechnician(bootstrapUser);
  const id = bootstrapUser?.id || Cookies.get('uid');
  const workerId = technician?.id || bootstrapUser?.id || Cookies.get('workerId') || id;
  const email =
    bootstrapUser?.username ||
    Cookies.get('email') ||
    Cookies.get('username');
  const fullName =
    sanitizeNameValue(technician?.full_name) ||
    sanitizeNameValue(bootstrapUser?.username) ||
    sanitizeNameValue(Cookies.get('fullName')) ||
    email;

  if (!id && !workerId && !email) {
    return null;
  }

  return {
    id,
    uid: id,
    email,
    workerId,
    role: bootstrapUser?.role || (Cookies.get('isAdmin') === 'true' ? 'ADMIN' : undefined),
    name: fullName,
    fullName,
    username: bootstrapUser?.username,
  };
}

/**
 * Rich profile for header/avatar (QuickMenu, overview welcome).
 */
export function mapBootstrapUserToProfile(bootstrapUser, emailFromCookie) {
  const email =
    sanitizeNameValue(emailFromCookie) ||
    sanitizeNameValue(Cookies.get('email')) ||
    sanitizeNameValue(Cookies.get('username'));

  if (!bootstrapUser) {
    const slim = mapBootstrapUserToCurrentUser(null);
    if (!slim) return null;
    return {
      ...slim,
      fullName: slim.fullName || slim.email,
      profilePicture: null,
    };
  }

  const technician = getTechnician(bootstrapUser);
  const fullName =
    sanitizeNameValue(technician?.full_name) ||
    sanitizeNameValue(bootstrapUser.username) ||
    sanitizeNameValue(email) ||
    email;

  return {
    ...bootstrapUser,
    id: bootstrapUser.id,
    fullName,
    email: bootstrapUser.username || email,
    profilePicture: technician?.avatar_url || null,
    role: bootstrapUser.role,
  };
}

/**
 * Legacy shape used by JobDetails upload/status/follow-up helpers.
 */
export function resolveCurrentUserInfo(bootstrapUser) {
  const user = mapBootstrapUserToCurrentUser(bootstrapUser);
  if (user) {
    return {
      email: user.email || Cookies.get('email'),
      name: user.name || user.fullName || user.email,
      workerId: user.workerId || user.id,
      uid: user.uid || user.id,
      id: user.id || user.uid || user.workerId,
    };
  }

  const email = Cookies.get('email');
  const workerId = Cookies.get('workerId');
  const uid = Cookies.get('uid');

  return {
    email: email || 'unknown@email.com',
    name: email || 'unknown@email.com',
    workerId: workerId || uid || 'UNKNOWN',
    uid: uid || workerId,
    id: uid || workerId,
  };
}
