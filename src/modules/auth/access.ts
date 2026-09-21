export interface IdClaims {
  tid?: string;
  oid?: string;
  aud?: string | string[];
  iss?: string;
  nonce?: string;
  name?: string;
  preferred_username?: string;
  email?: string;
  groups?: string[];
  /** Aanwezig bij groepen-overage: groepenlijst is dan niet in de token opgenomen. */
  _claim_names?: Record<string, string>;
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
  claims: IdClaims,
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
