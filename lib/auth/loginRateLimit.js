const WINDOW_MS = 15 * 60 * 1000;
const IP_LIMIT = 10;
const EMAIL_LIMIT = 5;

/** @type {Map<string, { count: number, windowStart: number }>} */
const attempts = new Map();

export const LOGIN_EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * @param {unknown} raw
 * @returns {string}
 */
export function normalizeLoginEmail(raw) {
  return typeof raw === 'string' ? raw.trim().toLowerCase() : '';
}

/**
 * @param {import('http').IncomingMessage} req
 * @returns {string}
 */
export function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    const first =
      typeof forwarded === 'string' ? forwarded.split(',')[0] : forwarded[0];
    return (first || '').trim() || 'unknown';
  }
  return (
    req.socket?.remoteAddress ||
    req.connection?.remoteAddress ||
    'unknown'
  );
}

/**
 * @param {string} type
 * @param {string} value
 * @returns {string}
 */
function buildKey(type, value) {
  return `${type}:${value}`;
}

/**
 * @param {string} key
 * @returns {{ count: number, windowStart: number }}
 */
function getAttemptRecord(key) {
  const now = Date.now();
  let record = attempts.get(key);
  if (!record || now - record.windowStart >= WINDOW_MS) {
    record = { count: 0, windowStart: now };
    attempts.set(key, record);
  }
  return record;
}

/**
 * @param {string} key
 * @param {number} limit
 * @returns {{ allowed: true } | { allowed: false, retryAfterSeconds: number }}
 */
function checkLimit(key, limit) {
  const record = getAttemptRecord(key);
  if (record.count >= limit) {
    const retryAfterMs = WINDOW_MS - (Date.now() - record.windowStart);
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)),
    };
  }
  return { allowed: true };
}

/**
 * @param {import('http').IncomingMessage} req
 * @param {string} email
 * @returns {{ allowed: true } | { allowed: false, retryAfterSeconds: number, message: string }}
 */
export function assertLoginAllowed(req, email) {
  const ip = getClientIp(req);
  const normalizedEmail = (email || '').trim().toLowerCase();

  const ipCheck = checkLimit(buildKey('ip', ip), IP_LIMIT);
  if (!ipCheck.allowed) {
    return {
      allowed: false,
      retryAfterSeconds: ipCheck.retryAfterSeconds,
      message:
        'Too many login attempts from this address. Please try again later.',
    };
  }

  const emailCheck = checkLimit(buildKey('email', normalizedEmail), EMAIL_LIMIT);
  if (!emailCheck.allowed) {
    return {
      allowed: false,
      retryAfterSeconds: emailCheck.retryAfterSeconds,
      message:
        'Too many login attempts for this email. Please try again later.',
    };
  }

  return { allowed: true };
}

/**
 * @param {import('http').IncomingMessage} req
 * @param {string} email
 */
export function recordLoginFailure(req, email) {
  const ip = getClientIp(req);
  const normalizedEmail = (email || '').trim().toLowerCase();

  getAttemptRecord(buildKey('ip', ip)).count += 1;
  getAttemptRecord(buildKey('email', normalizedEmail)).count += 1;
}

/**
 * @param {import('http').IncomingMessage} req
 * @param {string} email
 */
export function clearLoginAttempts(req, email) {
  const ip = getClientIp(req);
  const normalizedEmail = (email || '').trim().toLowerCase();

  attempts.delete(buildKey('ip', ip));
  attempts.delete(buildKey('email', normalizedEmail));
}
