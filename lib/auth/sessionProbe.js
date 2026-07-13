import { recordSessionProbe } from './sessionTabSync';

export async function fetchAuthenticatedUser() {
  try {
    const res = await fetch('/api/getUserInfo', {
      method: 'GET',
      credentials: 'include',
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.user ?? null;
  } finally {
    recordSessionProbe();
  }
}
