import { ConfidentialClientApplication, CryptoProvider } from '@azure/msal-node';
import type { Env } from '../../config/env.js';

const SCOPES = ['openid', 'profile', 'email'];

/** Ruwe vorm van een Entra ID-tokenclaims-set (MSAL geeft dit als een los object terug, geen eigen
 *  type). Leeft hier, bij de poort die de token daadwerkelijk ophaalt, niet in `modules/auth`: een
 *  integratie mag niet van het domeinmodel van zijn consument afhangen. */
export interface IdTokenClaims {
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

  async complete(code: string, codeVerifier: string, nonce: string): Promise<IdTokenClaims> {
    const result = await this.msal.acquireTokenByCode({
      code,
      scopes: SCOPES,
      redirectUri: this.env.ENTRA_REDIRECT_URI,
      codeVerifier,
      // Verplicht: msal-node weigert elk ID-token met een nonce als de verwachte nonce hier niet
      // wordt meegegeven (nonce_mismatch). Evaluatie van de claims (evaluateAccess) controleert
      // de nonce daarnaast nog eens zelf.
      nonce,
    });
    return (result.idTokenClaims ?? {}) as IdTokenClaims;
  }

  logoutUrl(): string {
    const base = `https://login.microsoftonline.com/${this.env.ENTRA_TENANT_ID}/oauth2/v2.0/logout`;
    const params = new URLSearchParams({
      post_logout_redirect_uri: this.env.ENTRA_POST_LOGOUT_REDIRECT_URI,
    });
    return `${base}?${params.toString()}`;
  }
}
