// Gebruik: npm run healthcheck [url]  (standaard APP_BASE_URL + APP_BASE_PATH + /health)
const base = process.env.APP_BASE_URL ?? 'http://localhost:3000';
const path = process.env.APP_BASE_PATH ?? '/tool';
const url = process.argv[2] ?? `${base}${path}/health`;

try {
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.status !== 'ok') throw new Error(`HTTP ${res.status}`);
  console.log(`✔ healthy: ${url}`);
} catch (err) {
  console.error(`✖ unhealthy: ${url} (${err instanceof Error ? err.message : 'onbekend'})`);
  process.exit(1);
}
