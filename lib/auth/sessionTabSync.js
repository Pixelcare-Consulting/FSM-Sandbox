/**
 * Cross-tab session coordination: shared activity timestamps and logout locks.
 * Used by useSessionCheck, useIdleTimeout, and ActivityTracker.
 */

export const SESSION_ACTIVITY_KEY = 'sas_portal_last_activity_at';
export const SESSION_LOGOUT_CHANNEL = 'sas_portal_session_logout';
export const SESSION_TAB_SYNC_CHANNEL = 'sas_portal_session_tab_sync';
export const SESSION_LOGOUT_LOCK_KEY = 'sas_portal_logout_lock';
export const SESSION_LOGOUT_MSG_KEY = 'sas_portal_session_logout_msg';
export const SESSION_POLL_LEADER_KEY = 'sas_portal_session_poll_leader';
export const WARMUP_LOCK_KEY = 'sas_portal_warmup_lock';

/** Grace period after login before forced logout on 401 (cookie propagation race). */
export const POST_LOGIN_GRACE_MS = 15 * 1000;

const LOGOUT_LOCK_TTL_MS = 5000;
const WARMUP_LOCK_TTL_MS = 60 * 1000;
/** Leader heartbeat stale threshold — visible tabs may claim leadership after this. */
const POLL_LEADER_STALE_MS = 45 * 1000;
/** Minimum gap between session probe API calls (getUserInfo vs renewSAPB1Session). */
export const SESSION_PROBE_MIN_GAP_MS = 5 * 1000;

let logoutChannel = null;
let tabSyncChannel = null;
let logoutInProgress = false;
let lastSessionProbeAt = 0;
let tabId = null;
let isPollLeader = false;

/** Returns true when a session probe API call may proceed (coordinates pollers). */
export function tryAcquireSessionProbe() {
  const now = Date.now();
  if (now - lastSessionProbeAt < SESSION_PROBE_MIN_GAP_MS) return false;
  lastSessionProbeAt = now;
  return true;
}

/** Stamp probe timestamp after getUserInfo outside tryAcquireSessionProbe. */
export function recordSessionProbe() {
  lastSessionProbeAt = Date.now();
}

function getTabId() {
  if (!tabId) {
    tabId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }
  return tabId;
}

function readPollLeaderEntry() {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(SESSION_POLL_LEADER_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.tabId || !Number.isFinite(parsed.at)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writePollLeaderEntry(at = Date.now()) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(
      SESSION_POLL_LEADER_KEY,
      JSON.stringify({ tabId: getTabId(), at })
    );
  } catch {
    // private mode / quota
  }
}

function clearPollLeaderEntryIfOwned() {
  if (typeof window === 'undefined') return;
  try {
    const entry = readPollLeaderEntry();
    if (entry?.tabId === getTabId()) {
      localStorage.removeItem(SESSION_POLL_LEADER_KEY);
    }
  } catch {
    // ignore
  }
}

function isDocumentVisible() {
  return typeof document === 'undefined' || document.visibilityState === 'visible';
}

function getTabSyncChannel() {
  if (typeof window === 'undefined') return null;
  if (!tabSyncChannel && typeof BroadcastChannel !== 'undefined') {
    try {
      tabSyncChannel = new BroadcastChannel(SESSION_TAB_SYNC_CHANNEL);
    } catch {
      tabSyncChannel = null;
    }
  }
  return tabSyncChannel;
}

function postTabSyncMessage(message) {
  const channel = getTabSyncChannel();
  if (!channel) return;
  try {
    channel.postMessage(message);
  } catch {
    // ignore
  }
}

/** True when this tab is the elected session poll leader. */
export function isSessionPollLeader() {
  return isPollLeader;
}

/**
 * Claim or refresh session poll leadership. Hidden tabs never become leader.
 * @returns {boolean}
 */
export function tryBecomeSessionPollLeader() {
  if (typeof window === 'undefined') return false;
  if (!isDocumentVisible()) {
    isPollLeader = false;
    return false;
  }

  const now = Date.now();
  const myId = getTabId();
  const entry = readPollLeaderEntry();

  if (entry?.tabId === myId) {
    isPollLeader = true;
    writePollLeaderEntry(now);
    return true;
  }

  if (entry && now - entry.at < POLL_LEADER_STALE_MS) {
    isPollLeader = false;
    return false;
  }

  isPollLeader = true;
  writePollLeaderEntry(now);
  postTabSyncMessage({ type: 'POLL_LEADER_CLAIM', tabId: myId, at: now });
  return true;
}

/** Refresh leader heartbeat after a successful poll cycle. */
export function refreshSessionPollLeaderHeartbeat() {
  if (!isPollLeader || !isDocumentVisible()) return;
  writePollLeaderEntry(Date.now());
}

/** Release poll leadership when tab is hidden or unmounting. */
export function releaseSessionPollLeader() {
  if (!isPollLeader) return;
  isPollLeader = false;
  clearPollLeaderEntryIfOwned();
  postTabSyncMessage({ type: 'POLL_LEADER_RELEASE', tabId: getTabId(), at: Date.now() });
}

export function broadcastSessionPollOk(at = Date.now()) {
  postTabSyncMessage({ type: 'SESSION_POLL_OK', at });
}

export function broadcastSessionPollExpired(errData) {
  postTabSyncMessage({
    type: 'SESSION_POLL_EXPIRED',
    errData: errData || {},
    at: Date.now(),
  });
}

export function broadcastWarmupDone(at = Date.now()) {
  postTabSyncMessage({ type: 'WARMUP_DONE', at });
}

/**
 * @param {{ onOk?: (at: number) => void, onExpired?: (errData: object) => void }} handlers
 */
export function subscribeToSessionPoll(handlers = {}) {
  if (typeof window === 'undefined') return () => {};
  const cleanups = [];

  const channel = getTabSyncChannel();
  if (channel) {
    const handler = (event) => {
      const data = event.data;
      if (!data?.type) return;
      if (data.type === 'SESSION_POLL_OK') {
        handlers.onOk?.(data.at);
        return;
      }
      if (data.type === 'SESSION_POLL_EXPIRED') {
        handlers.onExpired?.(data.errData || {});
        return;
      }
      if (data.type === 'POLL_LEADER_CLAIM' || data.type === 'POLL_LEADER_RELEASE') {
        if (data.tabId !== getTabId()) {
          isPollLeader = false;
        }
      }
    };
    channel.addEventListener('message', handler);
    cleanups.push(() => channel.removeEventListener('message', handler));
  }

  const onStorage = (event) => {
    if (event.key !== SESSION_POLL_LEADER_KEY) return;
    const entry = readPollLeaderEntry();
    if (!entry || entry.tabId !== getTabId()) {
      isPollLeader = false;
    }
  };
  window.addEventListener('storage', onStorage);
  cleanups.push(() => window.removeEventListener('storage', onStorage));

  return () => cleanups.forEach((fn) => fn());
}

/** @param {(at?: number) => void} callback */
export function subscribeToWarmupDone(callback) {
  if (typeof window === 'undefined') return () => {};
  const cleanups = [];

  const channel = getTabSyncChannel();
  if (channel) {
    const handler = (event) => {
      if (event.data?.type === 'WARMUP_DONE') {
        callback(event.data.at);
      }
    };
    channel.addEventListener('message', handler);
    cleanups.push(() => channel.removeEventListener('message', handler));
  }

  return () => cleanups.forEach((fn) => fn());
}

/** Prevent multiple tabs from running app warmup concurrently. */
export function tryAcquireWarmupLock() {
  if (typeof window === 'undefined') return true;
  try {
    const now = Date.now();
    const existing = localStorage.getItem(WARMUP_LOCK_KEY);
    if (existing) {
      const ts = parseInt(existing, 10);
      if (Number.isFinite(ts) && now - ts < WARMUP_LOCK_TTL_MS) {
        return false;
      }
    }
    localStorage.setItem(WARMUP_LOCK_KEY, String(now));
    return true;
  } catch {
    return true;
  }
}

export function releaseWarmupLock() {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(WARMUP_LOCK_KEY);
  } catch {
    // ignore
  }
}

export const SESSION_ERROR_CODES = {
  NO_UID: 'NO_UID',
  NO_SESSION_ID: 'NO_SESSION_ID',
  SESSION_MISMATCH: 'SESSION_MISMATCH',
  USER_NOT_FOUND: 'USER_NOT_FOUND',
  USER_INACTIVE: 'USER_INACTIVE',
  DB_ERROR: 'DB_ERROR',
};

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function getSharedLastActivityAt() {
  if (typeof window === 'undefined') return Date.now();
  try {
    const stored = localStorage.getItem(SESSION_ACTIVITY_KEY);
    const parsed = stored ? parseInt(stored, 10) : NaN;
    return Number.isFinite(parsed) ? parsed : Date.now();
  } catch {
    return Date.now();
  }
}

export function setSharedLastActivityAt(timestamp = Date.now()) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(SESSION_ACTIVITY_KEY, String(timestamp));
  } catch {
    // private mode / quota
  }
}

export function clearSharedLastActivityAt() {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(SESSION_ACTIVITY_KEY);
  } catch {
    // private mode / quota
  }
}

/** Reset idle timer baseline after a fresh login (avoids stale localStorage timestamps). */
export function resetSharedActivityOnLogin(getCookie = () => null) {
  const now = Date.now();
  const loginRaw = getCookie?.('loginAt');
  const loginTs = loginRaw ? parseInt(loginRaw, 10) : NaN;
  const baseline = Number.isFinite(loginTs) ? Math.max(now, loginTs) : now;
  setSharedLastActivityAt(baseline);
  return baseline;
}

/**
 * Keep idle tracking aligned with the current login session.
 * - Logged out: wipe stale localStorage (no user action required).
 * - Logged in: ignore activity timestamps from before this loginAt cookie.
 */
export function syncActivityWithLoginSession(getCookie = () => null) {
  if (typeof window === 'undefined') return Date.now();

  if (!clientHasIdentityCookies(getCookie)) {
    clearSharedLastActivityAt();
    return Date.now();
  }

  const now = Date.now();
  const stored = getSharedLastActivityAt();
  const loginRaw = getCookie?.('loginAt');
  const loginTs = loginRaw ? parseInt(loginRaw, 10) : NaN;

  if (Number.isFinite(loginTs) && stored < loginTs) {
    const baseline = Math.max(now, loginTs);
    setSharedLastActivityAt(baseline);
    return baseline;
  }

  return stored;
}

export function subscribeToSharedActivity(callback) {
  if (typeof window === 'undefined') return () => {};
  const onStorage = (event) => {
    if (event.key !== SESSION_ACTIVITY_KEY || !event.newValue) return;
    const ts = parseInt(event.newValue, 10);
    if (Number.isFinite(ts)) callback(ts);
  };
  window.addEventListener('storage', onStorage);
  return () => window.removeEventListener('storage', onStorage);
}

function getLogoutChannel() {
  if (typeof window === 'undefined') return null;
  if (!logoutChannel && typeof BroadcastChannel !== 'undefined') {
    try {
      logoutChannel = new BroadcastChannel(SESSION_LOGOUT_CHANNEL);
    } catch {
      logoutChannel = null;
    }
  }
  return logoutChannel;
}

export function isLogoutInProgress() {
  return logoutInProgress;
}

export function broadcastSessionLogout(message) {
  const channel = getLogoutChannel();
  if (channel) {
    try {
      channel.postMessage({ type: 'SESSION_LOGOUT', message, at: Date.now() });
    } catch {
      // ignore
    }
  }
  try {
    localStorage.setItem(SESSION_LOGOUT_MSG_KEY, message || '');
    localStorage.setItem(`${SESSION_LOGOUT_LOCK_KEY}_signal`, String(Date.now()));
    localStorage.removeItem(`${SESSION_LOGOUT_LOCK_KEY}_signal`);
  } catch {
    // storage event for other tabs
  }
}

export function subscribeToSessionLogout(callback) {
  if (typeof window === 'undefined') return () => {};
  const cleanups = [];

  const channel = getLogoutChannel();
  if (channel) {
    const handler = (event) => {
      if (event.data?.type === 'SESSION_LOGOUT') {
        callback(event.data.message);
      }
    };
    channel.addEventListener('message', handler);
    cleanups.push(() => channel.removeEventListener('message', handler));
  }

  const onStorage = (event) => {
    if (event.key !== `${SESSION_LOGOUT_LOCK_KEY}_signal`) return;
    try {
      const msg =
        localStorage.getItem(SESSION_LOGOUT_MSG_KEY) ||
        'Session ended. Please log in again.';
      callback(msg);
    } catch {
      callback('Session ended. Please log in again.');
    }
  };
  window.addEventListener('storage', onStorage);
  cleanups.push(() => window.removeEventListener('storage', onStorage));

  return () => cleanups.forEach((fn) => fn());
}

export function tryAcquireLogoutLock() {
  if (typeof window === 'undefined') return true;
  try {
    const now = Date.now();
    const existing = localStorage.getItem(SESSION_LOGOUT_LOCK_KEY);
    if (existing) {
      const ts = parseInt(existing, 10);
      if (Number.isFinite(ts) && now - ts < LOGOUT_LOCK_TTL_MS) {
        return false;
      }
    }
    localStorage.setItem(SESSION_LOGOUT_LOCK_KEY, String(now));
    return true;
  } catch {
    return true;
  }
}

export function clientHasIdentityCookies(getCookie) {
  return Boolean(getCookie('uid') || getCookie('email'));
}

/**
 * True within ~15s after login — avoids false logout while cookies propagate.
 */
export function isWithinPostLoginGrace(getCookie) {
  const raw = getCookie('loginAt') || getCookie('LAST_ACTIVITY');
  if (!raw) return false;
  const ts = parseInt(raw, 10);
  if (!Number.isFinite(ts)) return false;
  return Date.now() - ts < POST_LOGIN_GRACE_MS;
}

/**
 * Decide whether a 401 auth error should trigger logout.
 * @param {object} errData - JSON body from API
 * @param {Function} getCookie - e.g. Cookies.get
 * @param {Function} [retryFetch] - optional async () => Response
 */
export async function shouldLogoutOnAuthError(errData, getCookie, retryFetch) {
  const code = errData?.code;
  const requiresLogin = errData?.requiresLogin;

  if (!requiresLogin) return { logout: false };
  if (code === SESSION_ERROR_CODES.DB_ERROR) return { logout: false };

  const hasIdentity = clientHasIdentityCookies(getCookie);

  if (code === SESSION_ERROR_CODES.USER_INACTIVE) {
    return {
      logout: true,
      message: errData.message || 'Account is not active',
    };
  }

  if (code === SESSION_ERROR_CODES.NO_SESSION_ID && hasIdentity) {
    return { logout: false };
  }

  if (code === SESSION_ERROR_CODES.NO_SESSION_ID && !hasIdentity) {
    return {
      logout: true,
      message: errData.message || 'Session expired. Please log in again.',
    };
  }

  if (code === SESSION_ERROR_CODES.NO_UID && hasIdentity) {
    if (retryFetch) {
      for (let i = 0; i < 2; i += 1) {
        await sleep(1500);
        try {
          const retryRes = await retryFetch();
          if (retryRes?.ok) return { logout: false };
        } catch {
          // continue
        }
      }
    }
    if (hasIdentity) return { logout: false };
  }

  if (
    code === SESSION_ERROR_CODES.SESSION_MISMATCH ||
    code === SESSION_ERROR_CODES.USER_NOT_FOUND
  ) {
    return {
      logout: true,
      message: errData.message || 'Session expired. Please log in again.',
    };
  }

  if (code === SESSION_ERROR_CODES.NO_UID && !hasIdentity) {
    return {
      logout: true,
      message: errData.message || 'Unauthorized - No session',
    };
  }

  // Legacy responses without structured code
  if (!code && requiresLogin) {
    if (hasIdentity) return { logout: false };
    return {
      logout: true,
      message: errData.message || 'Session expired. Please log in again.',
    };
  }

  return { logout: false };
}

/**
 * Perform coordinated logout — only one tab calls /api/logout.
 */
export async function coordinatedSessionLogout({
  message,
  reason,
  redirect,
}) {
  if (logoutInProgress) return;
  logoutInProgress = true;

  broadcastSessionLogout(message);
  clearSharedLastActivityAt();
  releaseSessionPollLeader();

  const acquired = tryAcquireLogoutLock();
  if (acquired) {
    try {
      await fetch('/api/logout', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reason || 'session_invalid' }),
      });
    } catch (error) {
      console.error('[sessionTabSync] Logout request failed:', error);
    }
  }

  if (typeof redirect === 'function') {
    redirect(message);
  }
}
