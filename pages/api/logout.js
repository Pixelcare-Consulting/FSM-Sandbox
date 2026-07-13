import { getSupabaseClient } from '../../lib/supabase/client';
import { getSupabaseAdmin } from '../../lib/supabase/server';
import { userService } from '../../lib/supabase/database';
import { invalidateSessionCache } from '../../lib/auth/requireSession';
import { serverLogActivity } from '../../utils/serverLogActivity';
import {
  writeAuditLogFromRequest,
  AUDIT_CATEGORIES,
  AUDIT_ACTIONS,
  AUDIT_STATUS,
} from '../../lib/services/auditLog';
import {
  isRequestSecure,
  buildClearSessionCookies,
} from '../../lib/auth/cookieSecurity';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method Not Allowed' });
  }

  const isSecure = isRequestSecure(req);

  // Use uid (users table PK) for activity logging — workerId may be a technician ID
  // which does not satisfy the recent_activities.worker_id FK → users constraint.
  const uid = req.cookies.uid || null;
  const workerId = req.cookies.workerId;
  const userEmail = req.cookies.email || null;
  const userName = req.cookies.fullName || null;
  const logoutReason =
    (typeof req.body === 'object' && req.body?.reason) ||
    req.query?.reason ||
    'user_initiated';

  const auditLogout = (action, extra = {}, status = AUDIT_STATUS.SUCCESS) =>
    writeAuditLogFromRequest(req, {
      userId: uid,
      userEmail,
      userName,
      action,
      category: AUDIT_CATEGORIES.AUTH,
      description: action.replace(/_/g, ' ').toLowerCase(),
      details: extra,
      status,
    });

  try {
    // Log the start of logout process
    await serverLogActivity(uid, 'LOGOUT_INITIATED', {
      timestamp: new Date().toISOString(),
      reason: logoutReason,
      userAgent: req.headers['user-agent'],
      ip: req.headers['x-forwarded-for'] || req.socket.remoteAddress
    });

    // Sign out from Supabase (if using Supabase Auth)
    const supabase = getSupabaseClient();
    if (supabase) {
      await supabase.auth.signOut();
    }

    if (uid) {
      invalidateSessionCache(uid);
      try {
        const supabaseAdmin = getSupabaseAdmin();
        await userService.update(
          uid,
          { is_logged_in: false, current_session_id: null },
          supabaseAdmin
        );
      } catch (sessionClearErr) {
        console.warn('Failed to clear portal session flags on logout:', sessionClearErr.message);
      }
    }

    const cookiesToClear = buildClearSessionCookies(isSecure);
    res.setHeader('Set-Cookie', cookiesToClear);

    // Try to invalidate SAP B1 session if needed
    const b1Session = req.cookies.B1SESSION;
    if (b1Session) {
      try {
        await fetch(`${process.env.SAP_SERVICE_LAYER_BASE_URL}Logout`, {
          method: 'POST',
          headers: {
            'Cookie': `B1SESSION=${b1Session}`
          }
        });

        // Log successful SAP B1 logout
        await serverLogActivity(uid, 'SAP_B1_LOGOUT_SUCCESS', {
          timestamp: new Date().toISOString(),
          sessionId: b1Session.substring(0, 8) + '...' // Log only part of the session ID for security
        });
      } catch (error) {
        console.warn('Failed to invalidate SAP B1 session:', error);
        // Log SAP B1 logout failure
        await serverLogActivity(uid, 'SAP_B1_LOGOUT_FAILED', {
          timestamp: new Date().toISOString(),
          error: error.message
        });
      }
    }

    // Log successful logout
    await serverLogActivity(uid, 'LOGOUT_SUCCESS', {
      timestamp: new Date().toISOString(),
      reason: logoutReason,
      clearedCookies: cookiesToClear.length
    });

    await auditLogout(AUDIT_ACTIONS.LOGOUT, {
      clearedCookies: cookiesToClear.length,
      reason: logoutReason,
    });

    return res.status(200).json({ 
      message: 'Logout successful',
      cleared: cookiesToClear.length
    });
  } catch (error) {
    console.error('Logout error:', error);
    
    // Log logout failure
    await serverLogActivity(uid, 'LOGOUT_FAILED', {
      timestamp: new Date().toISOString(),
      error: error.message,
      stack: error.stack
    });
    await auditLogout(AUDIT_ACTIONS.LOGOUT, { error: error.message }, AUDIT_STATUS.FAILURE);
    
    // Attempt to clear cookies even if logout fails
    res.setHeader('Set-Cookie', buildClearSessionCookies(isSecure));

    return res.status(500).json({ 
      message: 'Partial logout completed with errors', 
      error: error.message 
    });
  }
}
