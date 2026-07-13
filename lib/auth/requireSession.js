/**
 * Single-device-per-user session validation.
 * Validates that the request's sessionId cookie matches users.current_session_id.
 * When a user logs in on a new device, the old device's sessionId no longer matches
 * and subsequent requests return 401.
 */

import { userService } from '../supabase/database';
import { getSupabaseAdmin } from '../supabase/server';
import { SESSION_ERROR_CODES } from './sessionTabSync';
import {
  getCachedSessionUser,
  invalidateCachedSessionUser,
  resolveSessionUserWithDedupe,
  setCachedSessionUser,
} from './sessionValidationCache';

const UNAUTHORIZED_MESSAGE = 'Session expired. Another device may have logged in. Please log in again.';

export { SESSION_ERROR_CODES };

/** Clear cached session rows for a user (e.g. on logout or session reset). */
export function invalidateSessionCache(uid) {
  invalidateCachedSessionUser(uid);
}

function sendUnauthorized(res, code, message, requiresLogin = true) {
  const status = code === SESSION_ERROR_CODES.USER_INACTIVE ? 403 : 401;
  res.status(status).json({
    code,
    message,
    requiresLogin,
  });
}

/**
 * Validates session for single-device-per-user. Sends 401 and returns null if invalid.
 * @param {import('next').NextApiRequest} req
 * @param {import('next').NextApiResponse} res
 * @returns {Promise<{ user: object } | null>} User data if valid, null if 401 was sent
 */
export async function requireSession(req, res) {
  let uid = req.cookies?.uid;
  const sessionId = req.cookies?.sessionId;
  const email = req.cookies?.email;

  if (!uid && email) {
    try {
      const db = getSupabaseAdmin();
      const userByEmail = await userService.findByEmailForSession(email, db);
      if (userByEmail?.id) {
        uid = userByEmail.id;
      }
    } catch (error) {
      console.error('[requireSession] Email fallback error:', error.message);
      sendUnauthorized(res, SESSION_ERROR_CODES.DB_ERROR, UNAUTHORIZED_MESSAGE, false);
      return null;
    }
  }

  if (!uid) {
    console.warn('[requireSession] NO_UID', {
      path: req.url,
      hasEmail: !!email,
      hasSessionId: !!sessionId,
      hasB1Session: !!req.cookies?.B1SESSION,
    });
    sendUnauthorized(
      res,
      SESSION_ERROR_CODES.NO_UID,
      'Unauthorized - No session'
    );
    return null;
  }

  if (!sessionId) {
    sendUnauthorized(res, SESSION_ERROR_CODES.NO_SESSION_ID, UNAUTHORIZED_MESSAGE);
    return null;
  }

  const cachedUser = getCachedSessionUser(uid, sessionId);
  if (cachedUser) {
    if (cachedUser.status !== 'ACTIVE') {
      sendUnauthorized(res, SESSION_ERROR_CODES.USER_INACTIVE, 'Account is not active');
      return null;
    }
    return { user: cachedUser };
  }

  try {
    const db = getSupabaseAdmin();
    let userData = await resolveSessionUserWithDedupe(uid, sessionId, () =>
      userService.findByIdForSession(uid, db)
    );
    if (!userData && email) {
      userData = await userService.findByEmailForSession(email, db);
    }
    if (!userData) {
      sendUnauthorized(res, SESSION_ERROR_CODES.USER_NOT_FOUND, UNAUTHORIZED_MESSAGE);
      return null;
    }

    if (userData.status !== 'ACTIVE') {
      sendUnauthorized(res, SESSION_ERROR_CODES.USER_INACTIVE, 'Account is not active');
      return null;
    }

    const storedSessionId = userData.current_session_id;
    if (storedSessionId !== null && storedSessionId !== sessionId) {
      console.warn('[requireSession] SESSION_MISMATCH', {
        path: req.url,
        uidPresent: !!uid,
        uidPrefix: uid ? String(uid).slice(0, 8) : null,
        cookieSessionPrefix: sessionId ? String(sessionId).slice(0, 8) : null,
        storedSessionPrefix: storedSessionId ? String(storedSessionId).slice(0, 8) : null,
        hasEmail: !!email,
      });
      sendUnauthorized(res, SESSION_ERROR_CODES.SESSION_MISMATCH, UNAUTHORIZED_MESSAGE);
      return null;
    }

    setCachedSessionUser(uid, sessionId, userData);
    return { user: userData };
  } catch (error) {
    console.error('[requireSession] Error:', error.message);
    sendUnauthorized(res, SESSION_ERROR_CODES.DB_ERROR, UNAUTHORIZED_MESSAGE, false);
    return null;
  }
}

