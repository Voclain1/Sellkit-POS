import type { Role, User } from '../types/pos';

/** Roles the back office is open to. The server enforces the same list. */
export const ADMIN_ROLES: Role[] = ['ADMIN', 'MANAGER'];

/** Whether this user may see inventory and trading figures. */
export const canAccessAdmin = (user: User | null): boolean =>
  user !== null && ADMIN_ROLES.includes(user.role);
