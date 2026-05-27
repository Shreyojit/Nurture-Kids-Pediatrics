export type UserRole = 'staff' | 'admin' | 'parent';

export type AuthContext = {
  id: string;
  role: UserRole;
  /** Root organization ID – used for ALL data isolation queries. */
  practiceId: string;
  email: string;
  /** The specific location/branch this staff member is homed to. Null for org-wide accounts. */
  locationId?: string | null;
};

export type ApiError = {
  code: string;
  message: string;
  details?: Record<string, unknown>;
};
