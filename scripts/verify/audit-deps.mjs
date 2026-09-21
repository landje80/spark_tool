// npm audit met een expliciete, gedocumenteerde allowlist (zie docs/architecture/technology-decisions.md).
import { spawnSync } from 'node:child_process';

// GHSA-ggr8-5vv4-36mx: deepmerge-ts in de Prisma CLI (build/migratie-tijd, geen runtime-invoer van gebruikers).
const ALLOWED_ADVISORIES = new Set(['GHSA-ggr8-5vv4-36mx']);
const ALLOWED_PACKAGES = new Set(['deepmerge-ts', '@prisma/config', 'prisma']);

const r = spawnSync('npm', ['audit', '--omit=dev', '--json'], { encoding: 'utf8', shell: true });
let report;
try {
  report = JSON.parse(r.stdout);
} catch {
  console.error('npm audit gaf geen geldige JSON; controleer netwerk/registry.');
  process.exit(1);
}

const blocking = [];
for (const [name, v] of Object.entries(report.vulnerabilities ?? {})) {
  if (!['high', 'critical'].includes(v.severity)) continue;
  const advisories = (v.via ?? []).filter((x) => typeof x === 'object');
  const onlyAllowed =
    ALLOWED_PACKAGES.has(name) &&
    advisories.every((a) => ALLOWED_ADVISORIES.has(a.url?.split('/').pop()));
  if (!onlyAllowed) blocking.push(`${name} (${v.severity})`);
}
if (blocking.length) {
  console.error(`Blokkerende kwetsbaarheden:\n - ${blocking.join('\n - ')}`);
  process.exit(1);
}
console.log('npm audit: geen blokkerende high/critical kwetsbaarheden (allowlist toegepast).');
