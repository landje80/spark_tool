import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { parseEnv } from '../config/env.js';
import { createApp } from './app.js';

// Geen database nodig: alleen routes die geen sessie-opslag raken worden aangeroepen
// (sessies met saveUninitialized=false schrijven niets zonder data).
const env = parseEnv({
  NODE_ENV: 'test',
  DATABASE_URL: 'mysql://x:x@localhost:3306/x',
  SESSION_SECRET: 'x'.repeat(40),
  // Expliciet getest onder een subpad (onafhankelijk van de productiestandaard '/'); zie het
  // tweede testgeval hieronder dat juist controleert dat het ook zónder prefix werkt.
  APP_BASE_PATH: '/tool',
  ENTRA_TENANT_ID: 't',
  ENTRA_CLIENT_ID: 'c',
  ENTRA_CLIENT_SECRET: 's',
  ENTRA_REDIRECT_URI: 'http://localhost:3000/tool/auth/callback',
  ENTRA_POST_LOGOUT_REDIRECT_URI: 'http://localhost:3000/tool/login',
});

describe('routes onder /tool', () => {
  let app: ReturnType<typeof createApp>;
  beforeAll(() => {
    app = createApp(env);
  });

  it('health werkt onder het basispad', async () => {
    const res = await request(app).get('/tool/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('health werkt ook als het prefix door de proxy is afgestript', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
  });

  it('zet veiligheidsheaders en een request-id', async () => {
    const res = await request(app).get('/tool/health');
    expect(res.headers['content-security-policy']).toContain("default-src 'self'");
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-request-id']).toBeTruthy();
  });
});
