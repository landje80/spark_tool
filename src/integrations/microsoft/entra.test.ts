import { describe, expect, it, vi } from 'vitest';
import { parseEnv } from '../../config/env.js';
import { EntraClient } from './entra.js';

const env = parseEnv({
  NODE_ENV: 'test',
  DATABASE_URL: 'mysql://x:x@localhost:3306/x',
  SESSION_SECRET: 'x'.repeat(40),
  ENTRA_TENANT_ID: 'tenant',
  ENTRA_CLIENT_ID: 'client',
  ENTRA_CLIENT_SECRET: 'secret',
  ENTRA_REDIRECT_URI: 'http://localhost:3000/auth/callback',
  ENTRA_POST_LOGOUT_REDIRECT_URI: 'http://localhost:3000/login',
});

describe('EntraClient', () => {
  it('geeft de verwachte nonce door aan MSAL bij het inwisselen van de code', async () => {
    // msal-node weigert een ID-token met een nonce (nonce_mismatch) als de verwachte nonce niet in
    // het verzoek zit. De integratietests mocken EntraClient, dus alleen deze test dekt dat af.
    const acquireTokenByCode = vi.fn().mockResolvedValue({ idTokenClaims: { oid: 'o' } });
    const client = new EntraClient(env);
    (client as unknown as { msal: unknown }).msal = { acquireTokenByCode };

    await client.complete('auth-code', 'verifier', 'nonce-123');

    expect(acquireTokenByCode).toHaveBeenCalledOnce();
    expect(acquireTokenByCode.mock.calls[0]?.[0]).toMatchObject({
      code: 'auth-code',
      codeVerifier: 'verifier',
      nonce: 'nonce-123',
      redirectUri: 'http://localhost:3000/auth/callback',
    });
  });
});
