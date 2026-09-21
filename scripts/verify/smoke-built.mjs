// Start de GEBOUWDE server (zoals Plesk dat doet) en controleert /tool/health en de SPA-uitlevering.
// Vangt fouten in startpad, build-uitvoer en routing onder /tool die typecheck en tests niet zien.
import { spawn } from 'node:child_process';

const PORT = 3990 + Math.floor(Math.random() * 9);
const ENTRY = 'dist/server/src/server/index.js';
const base = `http://127.0.0.1:${PORT}/tool`;

const child = spawn(process.execPath, [ENTRY], {
  env: {
    ...process.env,
    NODE_ENV: 'development',
    PORT: String(PORT),
    LOG_LEVEL: 'silent',
    APP_BASE_URL: `http://127.0.0.1:${PORT}`,
    APP_BASE_PATH: '/tool',
    DATABASE_URL: 'mysql://smoke:smoke@127.0.0.1:1/smoke', // wordt niet gebruikt door /health
    SESSION_SECRET: 'smoke-test-secret-'.padEnd(40, 'x'),
    ENTRA_TENANT_ID: 'smoke',
    ENTRA_CLIENT_ID: 'smoke',
    ENTRA_CLIENT_SECRET: 'smoke',
    ENTRA_REDIRECT_URI: `http://127.0.0.1:${PORT}/tool/auth/callback`,
    ENTRA_POST_LOGOUT_REDIRECT_URI: `http://127.0.0.1:${PORT}/tool/login`,
  },
  stdio: ['ignore', 'ignore', 'pipe'],
});
let stderr = '';
child.stderr.on('data', (d) => (stderr += d));
let exited = null;
child.on('exit', (code) => (exited = code));

async function waitFor(fn, ms = 20000) {
  const end = Date.now() + ms;
  let last;
  while (Date.now() < end) {
    if (exited !== null) throw new Error(`server stopte met code ${exited}: ${stderr.slice(-400)}`);
    try {
      return await fn();
    } catch (e) {
      last = e;
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  throw last ?? new Error('timeout');
}

let failed = null;
try {
  const health = await waitFor(async () => {
    const r = await fetch(`${base}/health`);
    if (!r.ok) throw new Error(`health ${r.status}`);
    return r.json();
  });
  if (health.status !== 'ok') throw new Error('health gaf geen status ok');

  // Zonder prefix (als Passenger het afstript) moet dezelfde route werken.
  const bare = await fetch(`http://127.0.0.1:${PORT}/health`);
  if (!bare.ok) throw new Error('health zonder /tool-prefix werkt niet');

  const page = await fetch(`${base}/login`);
  const html = await page.text();
  if (!page.ok || !html.includes('<div id="root">'))
    throw new Error('SPA wordt niet uitgeleverd onder /tool/login');
  const asset = html.match(/(?:src|href)="(\/tool\/assets\/[^"]+\.(?:js|css))"/)?.[1];
  if (!asset) throw new Error('index.html verwijst niet naar assets onder /tool/assets/');
  const a = await fetch(`http://127.0.0.1:${PORT}${asset}`);
  if (!a.ok) throw new Error(`asset ${asset} niet bereikbaar (${a.status})`);
} catch (err) {
  failed = err instanceof Error ? err.message : String(err);
} finally {
  child.kill();
}
if (failed) {
  console.error(`Smoke-test van gebouwde server mislukt: ${failed}`);
  process.exit(1);
}
console.log('Smoke-test: gebouwde server start, /tool/health, SPA en assets onder /tool werken.');
