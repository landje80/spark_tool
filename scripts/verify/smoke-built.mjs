// Start de GEBOUWDE server (zoals Plesk dat doet) en controleert /tool/health en de SPA-uitlevering.
// Vangt fouten in startpad, build-uitvoer en routing onder /tool die typecheck en tests niet zien.
//
// Twee runs:
//  1. Ontwikkelingsachtige env (zoals voorheen) — met, indien beschikbaar, de echte lokale
//     DATABASE_URL zodat /health daadwerkelijk een geslaagde databasecheck doet i.p.v. altijd tegen
//     een onbereikbare placeholder te lopen (sinds /health een echte `SELECT 1` doet).
//  2. Productie-env (NODE_ENV=production, https APP_BASE_URL, een Entra-allowlist ingevuld) — dit is
//     de enige plek die daadwerkelijk bevestigt dat de gebouwde server onder de productie-afdwingingen
//     uit src/config/env.ts (https-eis, default-deny-allowlist) succesvol *opstart*; `npm run verify`
//     draaide dit voorheen alleen met NODE_ENV=development en raakte dat pad dus nooit.
import { spawn } from 'node:child_process';

const ENTRY = 'dist/server/src/server/index.js';

async function waitFor(isExited, getStderr, fn, ms = 20000) {
  const end = Date.now() + ms;
  let last;
  while (Date.now() < end) {
    if (isExited() !== null) {
      throw new Error(`server stopte met code ${isExited()}: ${getStderr().slice(-400)}`);
    }
    try {
      return await fn();
    } catch (e) {
      last = e;
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  throw last ?? new Error('timeout');
}

/** @returns {Promise<string|null>} null bij succes, anders een foutmelding. */
async function runSmoke(label, buildEnv, { checkHealthOk, checkSpa }) {
  const port = 3990 + Math.floor(Math.random() * 500);
  const base = `http://127.0.0.1:${port}/tool`;

  const child = spawn(process.execPath, [ENTRY], {
    env: {
      ...process.env,
      PORT: String(port),
      LOG_LEVEL: 'silent',
      APP_BASE_PATH: '/tool',
      SESSION_SECRET: 'smoke-test-secret-'.padEnd(40, 'x'),
      ENTRA_TENANT_ID: 'smoke',
      ENTRA_CLIENT_ID: 'smoke',
      ENTRA_CLIENT_SECRET: 'smoke',
      ENTRA_REDIRECT_URI: `http://127.0.0.1:${port}/tool/auth/callback`,
      ENTRA_POST_LOGOUT_REDIRECT_URI: `http://127.0.0.1:${port}/tool/login`,
      ...buildEnv(port),
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (d) => (stderr += d));
  let exited = null;
  child.on('exit', (code) => (exited = code));

  try {
    const health = await waitFor(
      () => exited,
      () => stderr,
      async () => {
        const r = await fetch(`${base}/health`);
        const body = await r.json().catch(() => ({}));
        return { status: r.status, body };
      },
    );
    if (checkHealthOk && (health.status !== 200 || health.body.status !== 'ok')) {
      throw new Error(
        `health gaf geen status ok (HTTP ${health.status}, ${JSON.stringify(health.body)})`,
      );
    }
    if (![200, 503].includes(health.status)) {
      throw new Error(`health gaf een onverwachte HTTP-status (${health.status})`);
    }
    console.log(`  [${label}] /health → HTTP ${health.status} ${JSON.stringify(health.body)}`);

    if (checkSpa) {
      // Zonder prefix (als Passenger het afstript) moet dezelfde route werken.
      const bare = await fetch(`http://127.0.0.1:${port}/health`);
      if (!bare.ok) throw new Error('health zonder /tool-prefix werkt niet');

      const page = await fetch(`${base}/login`);
      const html = await page.text();
      if (!page.ok || !html.includes('<div id="root">')) {
        throw new Error('SPA wordt niet uitgeleverd onder /tool/login');
      }
      const asset = html.match(/(?:src|href)="(\/tool\/assets\/[^"]+\.(?:js|css))"/)?.[1];
      if (!asset) throw new Error('index.html verwijst niet naar assets onder /tool/assets/');
      const a = await fetch(`http://127.0.0.1:${port}${asset}`);
      if (!a.ok) throw new Error(`asset ${asset} niet bereikbaar (${a.status})`);
    }
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  } finally {
    child.kill();
  }
}

const errors = [];

// Run 1: ontwikkelingsachtig, met de echte lokale database als die beschikbaar is (anders de
// onbereikbare placeholder — /health mag dan gerust 503 geven, als de server zelf maar niet crasht).
const devDatabaseUrl = process.env.DATABASE_URL ?? 'mysql://smoke:smoke@127.0.0.1:1/smoke';
const err1 = await runSmoke(
  'ontwikkeling',
  (port) => ({
    NODE_ENV: 'development',
    APP_BASE_URL: `http://127.0.0.1:${port}`,
    DATABASE_URL: devDatabaseUrl,
  }),
  { checkHealthOk: false, checkSpa: true },
);
if (err1) errors.push(`ontwikkeling: ${err1}`);

// Run 2: productie-env — bevestigt dat de gebouwde server met de productie-afdwingingen uit env.ts
// daadwerkelijk opstart (https, allowlist ingevuld). Geen bereikbare database nodig voor deze
// bevestiging (parseEnv/serverstart falen niet op een onbereikbare DB; alleen een echte query zou
// dat doen — vandaar checkHealthOk:false, hier gaat het om het opstarten zelf).
const err2 = await runSmoke(
  'productie',
  () => ({
    NODE_ENV: 'production',
    APP_BASE_URL: 'https://smoke.invalid',
    DATABASE_URL: 'mysql://smoke:smoke@127.0.0.1:1/smoke',
    ENTRA_ALLOWED_USER_IDS: 'smoke-user',
    TRUST_PROXY: 'true',
  }),
  { checkHealthOk: false, checkSpa: false },
);
if (err2) errors.push(`productie: ${err2}`);

if (errors.length) {
  console.error(`Smoke-test van gebouwde server mislukt:\n - ${errors.join('\n - ')}`);
  process.exit(1);
}
console.log(
  'Smoke-test: gebouwde server start onder ontwikkelings- én productie-env, /tool/health, SPA en assets onder /tool werken.',
);
