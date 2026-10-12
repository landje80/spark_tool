import { describe, expect, it } from 'vitest';
import type { IdTokenClaims } from '../../integrations/microsoft/entra.js';
import { deriveRole, evaluateAccess, type AccessPolicy, type RoleGroupMap } from './access.js';

const policy: AccessPolicy = {
  tenantId: 'tenant-1',
  clientId: 'client-1',
  allowedGroupIds: ['group-a'],
  allowedUserIds: ['user-x'],
};
const base: IdTokenClaims = {
  tid: 'tenant-1',
  aud: 'client-1',
  iss: 'https://login.microsoftonline.com/tenant-1/v2.0',
  nonce: 'n1',
  oid: 'user-y',
  name: 'Test',
  preferred_username: 'Test@Juvion.nl',
  groups: ['group-a'],
};

describe('evaluateAccess', () => {
  it('staat toegang toe via groep', () => {
    const d = evaluateAccess(base, policy, 'n1');
    expect(d).toMatchObject({ allowed: true, email: 'test@juvion.nl' });
  });
  it('staat toegang toe via gebruikers-ID', () => {
    expect(evaluateAccess({ ...base, oid: 'user-x', groups: [] }, policy, 'n1').allowed).toBe(true);
  });
  it('weigert andere tenant', () => {
    expect(evaluateAccess({ ...base, tid: 'other' }, policy, 'n1')).toEqual({
      allowed: false,
      reason: 'tenant_mismatch',
    });
  });
  it('weigert verkeerde audience, issuer en nonce', () => {
    expect(evaluateAccess({ ...base, aud: 'x' }, policy, 'n1')).toMatchObject({ allowed: false });
    expect(
      evaluateAccess({ ...base, iss: 'https://evil.example/tenant-1/' }, policy, 'n1'),
    ).toMatchObject({ allowed: false });
    expect(evaluateAccess(base, policy, 'other-nonce')).toMatchObject({ allowed: false });
    expect(evaluateAccess({ ...base, iss: undefined }, policy, 'n1')).toEqual({
      allowed: false,
      reason: 'issuer_mismatch',
    });
  });
  it('weigert tenantlid zonder toewijzing (default deny)', () => {
    expect(evaluateAccess({ ...base, groups: ['other'] }, policy, 'n1')).toEqual({
      allowed: false,
      reason: 'not_allowlisted',
    });
    expect(
      evaluateAccess({ ...base, groups: undefined }, { ...policy, allowedUserIds: [] }, 'n1')
        .allowed,
    ).toBe(false);
  });
  it('meldt groepen-overage apart', () => {
    const d = evaluateAccess(
      { ...base, groups: undefined, _claim_names: { groups: 'src1' } },
      policy,
      'n1',
    );
    expect(d).toEqual({ allowed: false, reason: 'groups_overage_not_allowlisted' });
  });
});

describe('deriveRole', () => {
  const map: RoleGroupMap = {
    ADMIN: ['g-admin'],
    MANAGER: ['g-manager'],
    SALES: ['g-sales'],
    CONTENT_EDITOR: ['g-content'],
    VIEWER: ['g-viewer'],
  };
  const withGroups = (groups: string[] | undefined, extra: Partial<IdTokenClaims> = {}) => ({
    ...base,
    groups,
    ...extra,
  });

  it('geeft per rolgroep de bijbehorende rol', () => {
    expect(deriveRole(withGroups(['g-admin']), map)).toBe('ADMIN');
    expect(deriveRole(withGroups(['g-manager']), map)).toBe('MANAGER');
    expect(deriveRole(withGroups(['g-sales']), map)).toBe('SALES');
    expect(deriveRole(withGroups(['g-content']), map)).toBe('CONTENT_EDITOR');
    expect(deriveRole(withGroups(['g-viewer']), map)).toBe('VIEWER');
  });

  it('kiest de hoogste rol bij meerdere rolgroepen', () => {
    expect(deriveRole(withGroups(['g-viewer', 'g-sales', 'g-manager']), map)).toBe('MANAGER');
    expect(deriveRole(withGroups(['g-sales', 'g-admin']), map)).toBe('ADMIN');
  });

  it('geeft VIEWER (minste rechten) als er geen rolgroep matcht', () => {
    expect(deriveRole(withGroups(['group-a', 'andere-groep']), map)).toBe('VIEWER');
    expect(deriveRole(withGroups([]), map)).toBe('VIEWER');
  });

  it('wijzigt niets zonder rolgroepen, zonder groepenlijst of bij groepen-overage', () => {
    expect(deriveRole(withGroups(['g-admin']), {})).toBeNull();
    expect(deriveRole(withGroups(['g-admin']), { ADMIN: [], VIEWER: [] })).toBeNull();
    expect(deriveRole(withGroups(undefined), map)).toBeNull();
    expect(deriveRole(withGroups(undefined, { _claim_names: { groups: 'src1' } }), map)).toBeNull();
  });
});
