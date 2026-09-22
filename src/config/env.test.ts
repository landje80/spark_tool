import { describe, expect, it } from 'vitest';
import { parseEnv } from './env.js';

// De twee belangrijkste productie-veiligheidsmaatregelen (https-eis, default-deny-allowlist) staan
// beide in parseEnv() en worden nergens anders afgedwongen of getest — dit bestand is dus de enige
// plek die een regressie hierin (bv. iemand verwijdert de throw) zou vangen. Zie ook
// scripts/verify/smoke-built.mjs, dat bewust met NODE_ENV=development draait en deze paden dus niet raakt.
const base = {
  DATABASE_URL: 'mysql://x:x@localhost:3306/x',
  SESSION_SECRET: 'x'.repeat(40),
  ENTRA_TENANT_ID: 't',
  ENTRA_CLIENT_ID: 'c',
  ENTRA_CLIENT_SECRET: 's',
  ENTRA_REDIRECT_URI: 'https://spark.nicenext.nl/tool/auth/callback',
  ENTRA_POST_LOGOUT_REDIRECT_URI: 'https://spark.nicenext.nl/tool/login',
};

describe('parseEnv — productie-eisen', () => {
  it('staat http toe in ontwikkeling', () => {
    expect(() =>
      parseEnv({ ...base, NODE_ENV: 'development', APP_BASE_URL: 'http://localhost:3000' }),
    ).not.toThrow();
  });

  it('weigert http in productie', () => {
    expect(() =>
      parseEnv({
        ...base,
        NODE_ENV: 'production',
        APP_BASE_URL: 'http://spark.nicenext.nl',
        ENTRA_ALLOWED_USER_IDS: 'u1',
      }),
    ).toThrow(/https/i);
  });

  it('accepteert https in productie', () => {
    expect(() =>
      parseEnv({
        ...base,
        NODE_ENV: 'production',
        APP_BASE_URL: 'https://spark.nicenext.nl',
        ENTRA_ALLOWED_USER_IDS: 'u1',
      }),
    ).not.toThrow();
  });

  it('weigert productie zonder allowlist (default deny)', () => {
    expect(() =>
      parseEnv({
        ...base,
        NODE_ENV: 'production',
        APP_BASE_URL: 'https://spark.nicenext.nl',
      }),
    ).toThrow(/allowlist|ENTRA_ALLOWED/i);
  });

  it('accepteert productie met alleen een groepen-allowlist (geen gebruikers-allowlist nodig)', () => {
    expect(() =>
      parseEnv({
        ...base,
        NODE_ENV: 'production',
        APP_BASE_URL: 'https://spark.nicenext.nl',
        ENTRA_ALLOWED_GROUP_IDS: 'g1',
      }),
    ).not.toThrow();
  });

  it('staat ontwikkeling zonder allowlist toe (de default-deny-eis geldt alleen in productie)', () => {
    expect(() =>
      parseEnv({ ...base, NODE_ENV: 'development', APP_BASE_URL: 'http://localhost:3000' }),
    ).not.toThrow();
  });
});
