/**
 * Role-Based Access Control
 * Two staff roles:
 *   admin — full control of practice data, can manage templates and delete records
 *   staff — daily clinical front-desk access (read, write, import, upload docs)
 */

export type StaffRole = 'admin' | 'staff';

const PERMISSIONS: Record<StaffRole, string[]> = {
  admin: [
    'patients:read', 'patients:write', 'patients:import',
    'assignments:read', 'assignments:write', 'assignments:delete',
    'templates:read', 'templates:write', 'templates:publish', 'templates:delete',
    'submissions:read', 'submissions:export',
    'documents:read', 'documents:upload', 'documents:delete',
  ],
  staff: [
    'patients:read', 'patients:write', 'patients:import',
    'assignments:read', 'assignments:write',
    'templates:read',
    'submissions:read', 'submissions:export',
    'documents:read', 'documents:upload',
  ],
};

export function can(role: string, permission: string): boolean {
  const allowed = PERMISSIONS[role as StaffRole] ?? [];
  return allowed.includes(permission);
}

/** Throws if the role lacks the permission — use in route handlers. */
export function assertCan(role: string, permission: string): void {
  if (!can(role, permission)) {
    const err = new Error(`FORBIDDEN: role '${role}' cannot '${permission}'`);
    (err as Error & { statusCode: number }).statusCode = 403;
    throw err;
  }
}
