import { api, authHeader } from './api';
import { getLocal, removeLocal, setLocal } from './storage';

const STORAGE_KEY = 'pediform_staff_session';

export type StaffSession = {
  token: string;
  orgName: string;
  locationName: string | null;
  email: string;
  role: 'admin' | 'staff';
};

export function getStaffSession(): StaffSession | null {
  const stored = getLocal<StaffSession | null>(STORAGE_KEY, null);
  if (stored?.token) return stored;

  // Legacy keys from before staffSession helper
  const legacyToken = getLocal<string | null>('pediform_staff_token', null);
  if (!legacyToken) return null;

  return {
    token: legacyToken,
    orgName: getLocal('pediform_staff_practice', ''),
    locationName: getLocal<string | null>('pediform_staff_location', null),
    email: getLocal('pediform_staff_email', ''),
    role: getLocal<'admin' | 'staff'>('pediform_staff_role', 'admin'),
  };
}

export function setStaffSession(session: StaffSession): void {
  setLocal(STORAGE_KEY, session);
}

export function clearStaffSession(): void {
  removeLocal(STORAGE_KEY);
  removeLocal('pediform_staff_token');
  removeLocal('pediform_staff_practice');
  removeLocal('pediform_staff_location');
  removeLocal('pediform_staff_email');
  removeLocal('pediform_staff_role');
}

/** Build session from login/register API user payload. */
export function staffSessionFromAuth(
  token: string,
  user: {
    email: string;
    role: 'admin' | 'staff' | string;
    org_name?: string;
    practice_name?: string;
    location_name?: string | null;
  },
): StaffSession {
  return {
    token,
    orgName: user.org_name ?? user.practice_name ?? '',
    locationName: user.location_name ?? null,
    email: user.email,
    role: user.role === 'staff' ? 'staff' : 'admin',
  };
}

/** Refresh org/location/email from server (e.g. after page reload). */
export async function hydrateStaffSession(token: string): Promise<StaffSession | null> {
  try {
    const me = await api<{
      email: string;
      role: 'admin' | 'staff';
      org_name: string;
      location_name: string | null;
    }>('/api/staff/me', { headers: authHeader(token) });
    const session: StaffSession = {
      token,
      orgName: me.org_name,
      locationName: me.location_name,
      email: me.email,
      role: me.role,
    };
    setStaffSession(session);
    return session;
  } catch {
    clearStaffSession();
    return null;
  }
}
