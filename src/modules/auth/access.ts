import type { Role } from '@prisma/client';
import type { Env } from '../../config/env.js';
import type { IdTokenClaims } from '../../integrations/microsoft/entra.js';

/** Van hoog naar laag: heeft iemand meerdere rolgroepen, dan wint de eerste. */
export const ROLE_PRIORITY: readonly Role[] = [
  'ADMIN',
  'MANAGER',
  'SALES',
  'CONTENT_EDITOR',
  'VIEWER',
];

export type RoleGroupMap = Partial<Record<Role, readonly string[]>>;

export function roleGroupMapFromEnv(env: Env): RoleGroupMap {
  return {
    ADMIN: env.ENTRA_GROUP_IDS_ADMIN,
    MANAGER: env.ENTRA_GROUP_IDS_MANAGER,
    SALES: env.ENTRA_GROUP_IDS_SALES,
    CONTENT_EDITOR: env.ENTRA_GROUP_IDS_CONTENT_EDITOR,
    VIEWER: env.ENTRA_GROUP_IDS_VIEWER,
  };
}

/** Alle groepen die aan een rol zijn gekoppeld; leden daarvan mogen inloggen. */
export const allRoleGroupIds = (map: RoleGroupMap): string[] =>
  ROLE_PRIORITY.flatMap((r) => [...(map[r] ?? [])]);

/**
 * Bepaalt de rol uit de Entra-groepen van de gebruiker (de hoogste rol waarvan hij of zij lid is). Een lid van
 * alleen de toegangsgroep zonder rolgroep wordt VIEWER (minste rechten). `null` betekent: de rol niet wijzigen,
 * omdat rollen niet via Entra worden beheerd (geen rolgroepen ingesteld) of omdat het token geen betrouwbare
 * groepenlijst bevat (ontbrekend, of overage bij >200 groepen).
 */
export function deriveRole(claims: IdTokenClaims, map: RoleGroupMap): Role | null {
  if (allRoleGroupIds(map).length === 0) return null;
  if (!Array.isArray(claims.groups) || claims._claim_names?.groups) return null;
  const groups = new Set(claims.groups);
  for (const role of ROLE_PRIORITY) {
    if ((map[role] ?? []).some((g) => groups.has(g))) return role;
  }
  return 'VIEWER';
}

export interface AccessPolicy {
  tenantId: string;
  clientId: string;
  allowedGroupIds: readonly string[];
  allowedUserIds: readonly string[];
}

export type AccessDecision =
  { allowed: true; oid: string; name: string; email: string } | { allowed: false; reason: string };

const deny = (reason: string): AccessDecision => ({ allowed: false, reason });

/**
 * Beslist of een Entra-identiteit toegang heeft. Default deny: zonder expliciete
 * gebruikers- of groepstoewijzing wordt iedereen geweigerd, ook uit de eigen tenant.
 */
export function evaluateAccess(
  claims: IdTokenClaims,
  policy: AccessPolicy,
  expectedNonce: string,
): AccessDecision {
  if (!claims.tid || claims.tid !== policy.tenantId) return deny('tenant_mismatch');
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.includes(policy.clientId)) return deny('audience_mismatch');
  if (
    !claims.iss ||
    !claims.iss.startsWith(`https://login.microsoftonline.com/${policy.tenantId}/`)
  ) {
    return deny('issuer_mismatch');
  }
  if (!claims.nonce || claims.nonce !== expectedNonce) return deny('nonce_mismatch');
  if (!claims.oid) return deny('missing_oid');

  const email = (claims.email ?? claims.preferred_username ?? '').toLowerCase();
  if (!email) return deny('missing_email');

  const byUser = policy.allowedUserIds.includes(claims.oid);
  const byGroup = (claims.groups ?? []).some((g) => policy.allowedGroupIds.includes(g));
  if (!byUser && !byGroup) {
    return deny(claims._claim_names?.groups ? 'groups_overage_not_allowlisted' : 'not_allowlisted');
  }
  return { allowed: true, oid: claims.oid, name: claims.name ?? email, email };
}
