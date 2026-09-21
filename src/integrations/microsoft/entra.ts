import { ConfidentialClientApplication, CryptoProvider } from '@azure/msal-node';
import type { Env } from '../../config/env.js';
import type { IdClaims } from '../../modules/auth/access.js';

const SCOPES = ['openid', 'profile', 'email'];

export interface AuthStart {
  url: string;
  state: string;
  nonce: string;
  codeVerifier: string;
}

/** Dunne wrapper rond MSAL Node (authorization code flow + PKCE, single-tenant authority). */
export class EntraClient {
  private readonly msal: ConfidentialClientApplication;
  private readonly crypto = new CryptoProvider();

  constructor(private readonly env: Env) {
    this.msal = new ConfidentialClientApplication({
      auth: {
        clientId: env.ENTRA_CLIENT_ID,
        clientSecret: env.ENTRA_CLIENT_SECRET,
        // Tenant-specifieke authority: nooit /common of /organizations.
        authority: `https://login.microsoftonline.com/${env.ENTRA_TENANT_ID}`,
      },
    });
  }

  async start(): Promise<AuthStart> {
    const state = this.crypto.createNewGuid();
    const nonce = this.crypto.createNewGuid();
    const { verifier, challenge } = await this.crypto.generatePkceCodes();
    const url = await this.msal.getAuthCodeUrl({
      scopes: SCOPES,
      redirectUri: this.env.ENTRA_REDIRECT_URI,
      state,
      nonce,
      codeChallenge: challenge,
      codeChallengeMethod: 'S256',
      prompt: 'select_account',
    });
    return { url, state, nonce, codeVerifier: verifier };
  }

  async complete(code: string, codeVerifier: string): Promise<IdClaims> {
    const result = await this.msal.acquireTokenByCode({
      code,
      scopes: SCOPES,
      redirectUri: this.env.ENTRA_REDIRECT_URI,
      codeVerifier,
    });
    return (result.idTokenClaims ?? {}) as IdClaims;
  }

  logoutUrl(): string {
    const base = `https://login.microsoftonline.com/${this.env.ENTRA_TENANT_ID}/oauth2/v2.0/logout`;
    const params = new URLSearchParams({
      post_logout_redirect_uri: this.env.ENTRA_POST_LOGOUT_REDIRECT_URI,
    });
    return `${base}?${params.toString()}`;
  }
}
