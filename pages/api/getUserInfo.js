import { requireSession } from '../../lib/auth/requireSession';

function applySessionResponseHeaders(res) {
  // Cookie-based JSON must not be cached — otherwise clients get 304 + stale body or skip revalidation logic
  res.setHeader('Cache-Control', 'private, no-store, max-age=0, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    applySessionResponseHeaders(res);
    return res.status(405).json({ message: 'Method not allowed' });
  }

  applySessionResponseHeaders(res);

  const session = await requireSession(req, res);
  if (!session) return;

  const { user: userData } = session;

  try {
    const uid = userData.id;

    // Map Supabase user data to expected format
    const technician = userData.technicians?.[0] || userData.technicians;
    const workerId = technician?.id || userData.id;
    const fullName = technician?.full_name || userData.username;

    if (process.env.NODE_ENV !== 'production') {
      console.log('✅ User data retrieved:', {
        email: userData.username,
        workerId,
        role: userData.role,
        fullName,
      });
    }

    return res.status(200).json({
      success: true,
      user: {
        id: userData.id,
        uid: uid,
        email: userData.username,
        workerId: workerId,
        role: userData.role,
        name: fullName
      }
    });

  } catch (error) {
    console.error('❌ Error fetching user info:', error);
    return res.status(500).json({
      message: 'Internal server error',
      error: error.message,
      debug: {
        availableCookies: Object.keys(req.cookies || {}),
        timestamp: new Date().toISOString()
      }
    });
  }
}
