import { describe, expect, it } from 'vitest';
import type { IdTokenClaims } from '../../integrations/microsoft/entra.js';
import { evaluateAccess, type AccessPolicy } from './access.js';

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
