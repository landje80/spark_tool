import type { Role } from '@prisma/client';

export const PERMISSIONS = [
  'prospect.read',
  'prospect.write',
  'prospect.export',
  'prospect.delete',
  'outreach.prepare',
  'outreach.send',
  'lead.run',
  'customer.manage',
  'content.upload_link',
  'content.review',
  'settings.manage',
  'user.manage',
  'audit.read',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/** Standaardrechten per rol; wordt geseed in RolePermission en is de fallback. */
export const DEFAULT_ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  ADMIN: PERMISSIONS,
  MANAGER: [
    'prospect.read',
    'prospect.write',
    'prospect.export',
    'outreach.prepare',
    'outreach.send',
    'lead.run',
    'customer.manage',
    'content.upload_link',
    'content.review',
    'audit.read',
  ],
  SALES: [
    'prospect.read',
    'prospect.write',
    'outreach.prepare',
    'outreach.send',
    'content.upload_link',
  ],
  CONTENT_EDITOR: ['prospect.read', 'content.upload_link', 'content.review'],
  VIEWER: ['prospect.read'],
};

export function roleHas(role: Role, permission: Permission): boolean {
  return DEFAULT_ROLE_PERMISSIONS[role].includes(permission);
}
