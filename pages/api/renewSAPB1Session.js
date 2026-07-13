// /api/renewSAPB1Session.js
import https from 'https';
import { requireSession } from '../../lib/auth/requireSession';
import { serviceLayerLoginRequest } from '../../lib/services/sapService';

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const sapSessionDebug =
  process.env.NODE_ENV !== 'production' || process.env.DEBUG_SAP_SESSION === '1';

function debugLog(...args) {
  if (sapSessionDebug) console.log(...args);
}

export default async function handler(req, res) {
  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({
      success: false,
      message: 'Method not allowed'
    });
  }

  const session = await requireSession(req, res);
  if (!session) return;

  const { user: userData } = session;
  const uid = userData.id;
  const technician = userData.technicians?.[0] || userData.technicians;
  const workerId = technician?.id || userData.id;
  const email = req.cookies.email || userData.username;
  const portalSessionId = req.cookies.sessionId;
  const customToken = req.cookies.customToken;
  const isAdmin = req.cookies.isAdmin;

  // Log all cookies for debugging
  debugLog('🔍 [renewSAPB1Session] Cookie check:', {
    hasUid: !!uid,
    hasWorkerId: !!workerId,
    hasEmail: !!email,
    hasCustomToken: !!customToken,
    hasIsAdmin: isAdmin !== undefined,
    hasB1Session: !!req.cookies.B1SESSION,
    hasB1SessionExpiry: !!req.cookies.B1SESSION_EXPIRY,
    timestamp: new Date().toISOString()
  });

  // Check if current session is still valid and has more than 5 minutes remaining
  // BUT: If B1SESSION is missing, always proceed with renewal (session creation)
  const currentExpiry = req.cookies.B1SESSION_EXPIRY;
  const hasB1Session = !!req.cookies.B1SESSION;
  
  // If session cookie is missing, always proceed with renewal (to create it)
  if (!hasB1Session) {
    debugLog('🔄 B1SESSION cookie missing - proceeding with session creation');
  } else if (currentExpiry) {
    try {
      const expiryTime = new Date(currentExpiry).getTime();
      const timeUntilExpiry = expiryTime - Date.now();
      
      // Only skip renewal if session has more than 5 minutes remaining
      if (timeUntilExpiry > 5 * 60 * 1000) {
        debugLog('⏳ Session still valid, skipping renewal');
        return res.status(200).json({
          success: true,
          message: 'Session still valid',
          expiryTime: new Date(expiryTime)
        });
      }
    } catch (error) {
      console.warn('⚠️ Error parsing current expiry, proceeding with renewal:', error);
      // Continue with renewal if expiry parsing fails
    }
  }

  debugLog('🔄 Starting SAP B1 session renewal');

  try {
    // SAP B1 Login
    debugLog('🌐 Attempting SAP B1 login...');
    
    // Debug: Log credentials (masked) and URL
    const companyDB = (process.env.SAP_B1_COMPANY_DB || '').trim();
    const username = (process.env.SAP_B1_USERNAME || '').trim();
    const password = (process.env.SAP_B1_PASSWORD || '').trim();
    const baseUrl = (process.env.SAP_SERVICE_LAYER_BASE_URL || '').trim();
    
    debugLog('🔐 Login Credentials Check:', {
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

    debugLog('🔍 Server: SAP B1 response status:', sapLoginResponse.status);

    if (!sapLoginResponse.ok) {
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

    const sapLoginData = await sapLoginResponse.json();
    const sessionId = sapLoginData.SessionId;
    const sessionExpiryTime = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes from now
    const maxAge = 30 * 60; // 30 minutes in seconds

    // Check if connection is secure (same logic as login.js)
    const forwardedProto = req.headers['x-forwarded-proto'];
    const isHttps = forwardedProto === 'https' || 
                     req.headers['x-forwarded-ssl'] === 'on' ||
                     (req.connection && req.connection.encrypted);
    
    // Only use Secure flag if actually over HTTPS
    // This prevents cookie issues when running production build on HTTP
    const isSecure = isHttps || false;
    
    debugLog('🔐 Server: Setting renewed session cookies', {
      sessionId: sessionId.substring(0, 8) + '...',
      expiryTime: sessionExpiryTime.toISOString(),
      maxAge: maxAge + ' seconds',
      isSecure: isSecure,
      isHttps: isHttps,
      forwardedProto: forwardedProto
    });

    // Build cookies array with CONSISTENT settings
    // Session cookies: 30 minutes (B1SESSION, B1SESSION_EXPIRY, ROUTEID)
    // Identity cookies: 7 days (uid, email, workerId) - longer expiration for renewal capability
    const sessionMaxAge = 30 * 60; // 30 minutes
    const identityMaxAge = 7 * 24 * 60 * 60; // 7 days
    
    // Build secure flag string conditionally
    const secureFlag = isSecure ? 'Secure; ' : '';
    
    const cookies = [
      `B1SESSION=${sessionId}; Path=/; HttpOnly; ${secureFlag}SameSite=Lax; Max-Age=${sessionMaxAge}`,
      `B1SESSION_EXPIRY=${sessionExpiryTime.toISOString()}; Path=/; ${secureFlag}SameSite=Lax; Max-Age=${sessionMaxAge}`,
      `ROUTEID=.node4; Path=/; ${secureFlag}SameSite=Lax; Max-Age=${sessionMaxAge}`,
      `sapConnectionStatus=connected; Path=/; ${secureFlag}SameSite=Lax; Max-Age=${sessionMaxAge}`,
      `LAST_ACTIVITY=${Date.now()}; Path=/; ${secureFlag}SameSite=Lax; Max-Age=${sessionMaxAge}`
    ];

    // Add identity cookies with longer expiration (7 days) so renewal can work even if session expires
    // This prevents the catch-22 where all cookies expire and renewal can't happen
    if (customToken) {
      cookies.push(`customToken=${customToken}; Path=/; HttpOnly; ${secureFlag}SameSite=Lax; Max-Age=${identityMaxAge}`);
      debugLog('✅ Including customToken in renewal (7 days expiration)');
    }
    if (uid) {
      cookies.push(`uid=${uid}; Path=/; ${secureFlag}SameSite=Lax; Max-Age=${identityMaxAge}`);
      debugLog('✅ Including uid in renewal (7 days expiration)');
    }
    if (email) {
      cookies.push(`email=${email}; Path=/; ${secureFlag}SameSite=Lax; Max-Age=${identityMaxAge}`);
      debugLog('✅ Including email in renewal (7 days expiration)');
    }
    if (workerId) {
      cookies.push(`workerId=${workerId}; Path=/; ${secureFlag}SameSite=Lax; Max-Age=${identityMaxAge}`);
      debugLog('✅ Including workerId in renewal (7 days expiration)');
    }
    if (portalSessionId) {
      cookies.push(`sessionId=${portalSessionId}; Path=/; ${secureFlag}SameSite=Lax; Max-Age=${identityMaxAge}`);
      debugLog('✅ Including sessionId in renewal (7 days expiration)');
    }
    if (isAdmin !== undefined) {
      cookies.push(`isAdmin=${isAdmin}; Path=/; ${secureFlag}SameSite=Lax; Max-Age=${identityMaxAge}`);
      debugLog('✅ Including isAdmin in renewal (7 days expiration)');
    }

    // Set cookies in response header
    res.setHeader('Set-Cookie', cookies);
    
    // Add custom headers to indicate successful renewal for client-side detection
    res.setHeader('X-Session-Renewed', 'true');
    res.setHeader('X-Session-Expiry', sessionExpiryTime.toISOString());
    res.setHeader('X-Session-Max-Age', maxAge.toString());

    debugLog('✅ Server: Session renewal complete!', {
      sessionId: sessionId.substring(0, 8) + '...',
      expiryTime: sessionExpiryTime.toISOString(),
      cookiesSet: cookies.length,
      cookieNames: ['B1SESSION', 'B1SESSION_EXPIRY', 'ROUTEID', 'sapConnectionStatus', 'LAST_ACTIVITY', 
                    ...(customToken ? ['customToken'] : []),
                    ...(uid ? ['uid'] : []),
                    ...(email ? ['email'] : []),
                    ...(workerId ? ['workerId'] : []),
                    ...(portalSessionId ? ['sessionId'] : []),
                    ...(isAdmin !== undefined ? ['isAdmin'] : [])]
    });

    return res.status(200).json({
      success: true,
      message: 'Session renewed successfully',
      expiryTime: sessionExpiryTime.toISOString(), // ISO string format for consistency
      maxAge: maxAge,
      renewedAt: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Server: Session renewal error:', {
      message: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString()
    });

    // Only clear session-related cookies on error, preserve user identity cookies
    // This allows the client to retry renewal without losing user context
    // Check if connection is secure (same logic as above)
    const forwardedProto = req.headers['x-forwarded-proto'];
    const isHttps = forwardedProto === 'https' || 
                     req.headers['x-forwarded-ssl'] === 'on' ||
                     (req.connection && req.connection.encrypted);
    const isSecure = isHttps || false;
    const secureFlag = isSecure ? 'Secure; ' : '';
    
    const clearCookies = [
      'B1SESSION',
      'B1SESSION_EXPIRY',
      'ROUTEID',
      'sapConnectionStatus'
    ].map(name => {
      // Use appropriate HttpOnly flag based on cookie type
      const httpOnly = ['B1SESSION'].includes(name);
      return `${name}=; Path=/; ${httpOnly ? 'HttpOnly; ' : ''}${secureFlag}SameSite=Lax; Expires=Thu, 01 Jan 1970 00:00:00 GMT`;
    });

    res.setHeader('Set-Cookie', clearCookies);
    res.setHeader('X-Session-Renewed', 'false');
    res.setHeader('X-Session-Error', error.message);

    debugLog('🧹 Server: Cleared session cookies after renewal failure:', {
      clearedCookies: ['B1SESSION', 'B1SESSION_EXPIRY', 'ROUTEID', 'sapConnectionStatus'],
      preservedCookies: ['uid', 'email', 'workerId', 'customToken', 'isAdmin']
    });

    return res.status(401).json({
      success: false,
      message: 'Session renewal failed',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
}
