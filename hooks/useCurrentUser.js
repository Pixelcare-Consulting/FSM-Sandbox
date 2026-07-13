import { useMemo } from 'react';
import Cookies from 'js-cookie';
import {
  mapBootstrapUserToCurrentUser,
  mapBootstrapUserToProfile,
  sanitizeNameValue,
} from '../lib/auth/mapCurrentUser';
import { useDashboardBootstrap } from './useDashboardBootstrap';

/**
 * Resolves the signed-in user from dashboard bootstrap with cookie fallbacks.
 * Prefer this over mount-time `/api/getUserInfo` fetches.
 */
export function useCurrentUser() {
  const { data: bootstrap, isLoading } = useDashboardBootstrap();
  const userData = bootstrap?.user;

  return useMemo(() => {
    const user = mapBootstrapUserToCurrentUser(userData);
    if (!user) {
      return { user: null, isLoading };
    }
    return {
      user,
      isLoading: isLoading && !userData,
    };
  }, [userData, isLoading]);
}

/**
 * Rich profile for header/avatar components (QuickMenu, overview welcome).
 */
export function useCurrentUserProfile() {
  const { data: bootstrap, isLoading } = useDashboardBootstrap();
  const userData = bootstrap?.user;
  const emailFromCookie =
    sanitizeNameValue(Cookies.get('email')) ||
    sanitizeNameValue(Cookies.get('username'));

  return useMemo(() => {
    const user = mapBootstrapUserToCurrentUser(userData);
    const profile = mapBootstrapUserToProfile(userData, emailFromCookie);
    return {
      user,
      profile,
      isLoading: isLoading && !userData,
    };
  }, [userData, isLoading, emailFromCookie]);
}

export { mapBootstrapUserToCurrentUser, mapBootstrapUserToProfile, resolveCurrentUserInfo } from '../lib/auth/mapCurrentUser';
