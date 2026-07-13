process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

import crypto from 'crypto';
import { getSupabaseAdmin } from '../../lib/supabase/server';
import { userService } from '../../lib/supabase/database';
import { serialize } from 'cookie';
import { serviceLayerLoginRequest } from '../../lib/services/sapService';
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
import {
  assertLoginAllowed,
  recordLoginFailure,
  clearLoginAttempts,
  LOGIN_EMAIL_REGEX,
  normalizeLoginEmail,
} from '../../lib/auth/loginRateLimit';

const COOKIE_OPTIONS = {
  secure: true,
  sameSite: 'lax',
  maxAge: 30 * 60, // 30 minutes
  httpOnly: true
};

// Add CORS headers
export const config = {
  api: {
    externalResolver: true,
    bodyParser: true,
  },
};

export default async function handler(req, res) {
  // Add CORS headers
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,DELETE,PATCH,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  // Handle preflight request
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  // Ensure method is POST
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const { email: rawEmail, password } = req.body || {};
  const email = normalizeLoginEmail(rawEmail);

  if (!email || !password) {
    return res.status(400).json({ message: 'Email and password are required' });
  }

  if (!LOGIN_EMAIL_REGEX.test(email)) {
    return res.status(400).json({ message: 'Please enter a valid email address' });
  }

  const rateLimit = assertLoginAllowed(req, email);
  if (!rateLimit.allowed) {
    res.setHeader('Retry-After', String(rateLimit.retryAfterSeconds));
    return res.status(429).json({
      message: rateLimit.message,
      retryAfterSeconds: rateLimit.retryAfterSeconds,
    });
  }

  try {
    console.log('🔐 Server: Login request received', {
      method: req.method,
      body: { email, passwordLength: password?.length }
    });

    console.log('🔍 Server: Attempting Supabase authentication...');
    
    // Step 1: Authenticate with Supabase Auth (handles password verification)
    const supabaseAdmin = getSupabaseAdmin();
    let authUser = null;
    let accessToken = null;
    let authUserId = null;

    try {
      console.log('🔐 Server: Attempting Supabase Auth signInWithPassword...');
      const { data: authData, error: authError } = await supabaseAdmin.auth.signInWithPassword({
        email: email,
        password: password
      });

      if (authError) {
        console.error('❌ Server: Supabase Auth authentication failed:', {
          message: authError.message,
          status: authError.status,
          code: authError.code
        });
        void writeAuditLogFromRequest(req, {
          action: AUDIT_ACTIONS.LOGIN_FAILED,
          category: AUDIT_CATEGORIES.AUTH,
          description: 'Login failed',
          details: { email, reason: authError.message || 'invalid_credentials' },
          status: AUDIT_STATUS.FAILURE,
        });
        recordLoginFailure(req, email);
        return res.status(401).json({ 
          message: authError.message || 'Invalid email or password' 
        });
      }

      if (!authData?.user) {
        console.error('❌ Server: No user returned from Supabase Auth');
        void writeAuditLogFromRequest(req, {
          action: AUDIT_ACTIONS.LOGIN_FAILED,
          category: AUDIT_CATEGORIES.AUTH,
          description: 'Login failed',
          details: { email, reason: 'no_auth_user' },
          status: AUDIT_STATUS.FAILURE,
        });
        recordLoginFailure(req, email);
        return res.status(401).json({ message: 'Authentication failed' });
      }

      authUser = authData.user;
      accessToken = authData.session?.access_token;
      authUserId = authUser.id;
      
      console.log('✅ Server: Supabase Auth sign-in successful', {
        authUserId: authUserId,
        email: authUser.email
      });
    } catch (authErr) {
      console.error('❌ Server: Supabase Auth exception:', {
        message: authErr.message,
        code: authErr.code,
        stack: authErr.stack
      });
      recordLoginFailure(req, email);
      return res.status(500).json({ 
        message: 'Authentication service error. Please try again.' 
      });
    }

    // Step 2: Fetch user details from custom users table using auth user ID
    let userData = null;
    try {
      console.log('📊 Server: Fetching user details from custom users table...', { 
        authUserId: authUserId,
        email: email 
      });
      
      // Use the same admin client as Auth — avoids Turbopack require('./server') breakage in getClient()
      userData = await userService.findById(authUserId, supabaseAdmin);
      if (!userData) {
        console.log('🔄 Server: No users row for auth ID, trying by username/email...');
        userData = await userService.findByEmail(email, supabaseAdmin);
      }

      if (!userData) {
        console.error('❌ Server: User not found in custom users table', {
          authUserId: authUserId,
          email: email
        });
        // User authenticated but no custom record - this is a configuration issue
        recordLoginFailure(req, email);
        return res.status(500).json({ 
          message: 'User account configuration error. Please contact administrator.' 
        });
      }

      console.log('✅ Server: User data retrieved from custom table', {
        userId: userData?.id,
        username: userData?.username,
        role: userData?.role,
        status: userData?.status,
        hasTechnicians: !!userData?.technicians,
        techniciansCount: userData?.technicians?.length || 0
      });
    } catch (dbError) {
      console.error('❌ Server: Database error fetching user details:', {
        message: dbError.message,
        code: dbError.code,
        details: dbError.details,
        hint: dbError.hint,
        stack: dbError.stack
      });
      recordLoginFailure(req, email);
      return res.status(500).json({ 
        message: 'Error retrieving user information. Please try again.' 
      });
    }

    // Step 3: Check user status from custom table
    if (userData.status !== 'ACTIVE') {
      console.log('❌ Server: User account is not active', {
        userId: userData.id,
        status: userData.status
      });
      return res.status(403).json({ message: 'Account is not active' });
    }

    // Get technician ID if user is a technician
    const technicianRow = userData.technicians?.[0] || userData.technicians;
    const technicianId = technicianRow?.id || null;
    // Cookie `uid` MUST be public.users.id — requireSession uses findById(uid) and compares
    // sessionId to users.current_session_id on that row. Using Supabase auth UUID here when it
    // differs from users.id breaks renewal + getUserInfo (immediate "session expired").
    const uid = userData.id;
    const workerId = technicianId || userData.id;
    // Display name for header/UI — must be set on login so a stale fullName cookie from another user cannot persist
    const loginFullName = String(
      technicianRow?.full_name || userData.username || email || ''
    ).trim();

    // Single-device-per-user: generate session ID and store in DB (invalidates other devices)
    const userSessionId = crypto.randomUUID();
    try {
      await userService.update(
        userData.id,
        { current_session_id: userSessionId, is_logged_in: true },
        supabaseAdmin
      );
    } catch (updateErr) {
      console.error('❌ Server: Failed to set current_session_id:', updateErr.message);
      return res.status(500).json({ message: 'Session setup failed. Please try again.' });
    }

    // SAP B1 Login with fallback handling
    console.log('🔄 Server: Attempting SAP B1 login...');
    let sessionId = null;
    let sapConnectionStatus = 'connected';
    let sapError = null;

    try {
      // Trim and validate environment variables
      const companyDB = (process.env.SAP_B1_COMPANY_DB || '').trim();
      const username = (process.env.SAP_B1_USERNAME || '').trim();
      const password = (process.env.SAP_B1_PASSWORD || '').trim();
      const baseUrl = (process.env.SAP_SERVICE_LAYER_BASE_URL || '').trim();
      
      console.log('🔐 Login Credentials Check:', {
        baseUrl: baseUrl,
        companyDB: companyDB,
        username: username,
        passwordLength: password.length,
        passwordHasSpecialChars: /[!@#$%^&*(),.?":{}|<>]/.test(password)
      });
      
      const sapLoginResponse = await serviceLayerLoginRequest({
        baseUrl,
        companyDB,
        username,
        password
      });

      console.log('🔍 Server: SAP B1 response status:', sapLoginResponse.status);

      if (sapLoginResponse.ok) {
        const sapLoginData = await sapLoginResponse.json();
        sessionId = sapLoginData.SessionId;
        console.log('✅ Server: SAP B1 login successful');
      } else {
        // Get the error response body for detailed error information
        const errorText = await sapLoginResponse.text();
        let errorDetails = errorText;
        
        try {
          const errorJson = JSON.parse(errorText);
          errorDetails = JSON.stringify(errorJson, null, 2);
          console.error('❌ SAP B1 Error Details:', errorDetails);
        } catch (e) {
          console.error('❌ SAP B1 Error Response (text):', errorText);
        }
        
        throw new Error(`SAP B1 login failed with status: ${sapLoginResponse.status} - ${errorDetails}`);
      }
    } catch (error) {
      console.log('⚠️ Server: SAP B1 connection failed, allowing limited access:', error.message);
      sapConnectionStatus = 'failed';
      sapError = error.message;
      // Generate a temporary session ID for limited access
      sessionId = `TEMP_SESSION_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
    }

    const sessionExpiryTime = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes
    const loginTimestamp = Date.now();
    const isSecure = isRequestSecure(req);

    console.log('🍪 Cookie security settings:', {
      isSecure,
      nodeEnv: process.env.NODE_ENV,
      forwardedProto: req.headers['x-forwarded-proto'] || req.headers['x-forwarded-protocol'],
      host: req.headers.host,
      connectionEncrypted: req.connection?.encrypted,
    });

    // Clear stale session cookies before setting new ones (prevents SESSION_MISMATCH from old sessionId)
    const clearCookies = buildClearSessionCookies(isSecure);
    
    // Set all required cookies using the cookie library for proper formatting
    // Session cookies expire in 30 minutes (B1SESSION, B1SESSION_EXPIRY, ROUTEID)
    const sessionCookieOptions = {
      path: '/',
      sameSite: 'lax',
      maxAge: 30 * 60, // 30 minutes
      secure: isSecure,
      httpOnly: false
    };
    
    // User identity cookies should last longer (7 days) so renewal can work even if session expires
    // This prevents the catch-22 where all cookies expire and renewal can't happen
    const identityCookieOptions = {
      path: '/',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60, // 7 days - long enough for renewal to work
      secure: isSecure,
      httpOnly: false
    };
    
    const cookies = [
      ...clearCookies,
      serialize('B1SESSION', sessionId, { ...sessionCookieOptions, httpOnly: true }),
      serialize('B1SESSION_EXPIRY', sessionExpiryTime.toISOString(), sessionCookieOptions),
      serialize('ROUTEID', '.node4', sessionCookieOptions),
      serialize('accessToken', accessToken, { ...sessionCookieOptions, httpOnly: true }),
      // Single-device-per-user: must match users.current_session_id
      serialize('sessionId', userSessionId, identityCookieOptions),
      // User identity cookies - longer expiration for renewal capability
      serialize('uid', uid, identityCookieOptions),
      serialize('email', email, identityCookieOptions),
      serialize('workerId', workerId, identityCookieOptions),
      serialize('isAdmin', String(userData.role === 'ADMIN'), identityCookieOptions),
      serialize('sapConnectionStatus', sapConnectionStatus, sessionCookieOptions),
      serialize('LAST_ACTIVITY', String(loginTimestamp), sessionCookieOptions),
      serialize('loginAt', String(loginTimestamp), identityCookieOptions),
      ...(loginFullName
        ? [serialize('fullName', loginFullName, identityCookieOptions)]
        : [])
    ];

    // Set cookies in response header - Next.js handles array of Set-Cookie headers
    // In production, ensure cookies are set properly
    try {
      res.setHeader('Set-Cookie', cookies);
      console.log('🔐 Server: Setting session cookies:', {
        sessionId: sessionId.substring(0, 8) + '...',
        expiryTime: sessionExpiryTime.toISOString(),
        sapStatus: sapConnectionStatus,
        cookiesCount: cookies.length,
        isSecure: isSecure
      });
    } catch (cookieError) {
      console.error('❌ Server: Error setting cookies:', cookieError);
      // Fallback: try setting cookies individually
      cookies.forEach((cookie, index) => {
        try {
          res.appendHeader('Set-Cookie', cookie);
        } catch (err) {
          console.error(`❌ Server: Error setting cookie ${index}:`, err);
        }
      });
    }


    clearLoginAttempts(req, email);

    // Return success response with connection status
    await writeAuditLogFromRequest(req, {
      userId: uid,
      userEmail: email,
      userName: loginFullName,
      action: AUDIT_ACTIONS.LOGIN,
      category: AUDIT_CATEGORIES.AUTH,
      description: `User logged in${sapConnectionStatus === 'connected' ? '' : ' (limited SAP access)'}`,
      details: { sapConnectionStatus, workerId },
      status: AUDIT_STATUS.SUCCESS,
    });

    return res.status(200).json({
      success: true,
      message: sapConnectionStatus === 'connected' ? 'Authentication successful' : 'Authentication successful with limited SAP access',
      sapConnectionStatus,
      sapError: sapConnectionStatus === 'failed' ? sapError : null,
      user: {
        email,
        workerId: workerId,
        uid: uid,
        isAdmin: userData.role === 'ADMIN'
      },
      cookiesSet: cookies.length
    });

  } catch (error) {
    console.error('❌ Server: Login error:', {
      message: error.message,
      code: error.code,
      details: error.details,
      hint: error.hint,
      stack: error.stack,
      errorType: error.constructor?.name,
      timestamp: new Date().toISOString()
    });

    // Log specific PostgreSQL errors
    if (error.code === '22007') {
      console.error('❌ Server: PostgreSQL timestamp error detected:', {
        errorCode: error.code,
        errorMessage: error.message,
        possibleCauses: [
          'Null value passed to timestamp field',
          'Invalid timestamp format in database operation',
          'Missing DEFAULT value for timestamp column',
          'Trigger attempting to set null timestamp'
        ]
      });
    }
    
    res.setHeader('Set-Cookie', buildClearSessionCookies(isRequestSecure(req)));

    void writeAuditLogFromRequest(req, {
      action: AUDIT_ACTIONS.LOGIN_FAILED,
      category: AUDIT_CATEGORIES.AUTH,
      description: 'Login failed',
      details: { reason: error.message || 'authentication_failed' },
      status: AUDIT_STATUS.FAILURE,
    });

    if (email) {
      recordLoginFailure(req, email);
    }

    return res.status(401).json({
      message: 'Authentication failed',
      error: error.message
    });
  }
}
