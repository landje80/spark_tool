// Voert alle kwaliteitscontroles uit; stopt bij de eerste fout. Gebruik: npm run verify
import 'dotenv/config';
import { spawnSync } from 'node:child_process';

const steps = [
  ['format', 'npm', ['run', 'format:check']],
  ['lint', 'npm', ['run', 'lint']],
  ['typecheck', 'npm', ['run', 'typecheck']],
  ['prisma validate', 'npx', ['prisma', 'validate']],
  ['migrations in git', 'node', ['scripts/verify/check-migrations.mjs']],
  ['onzichtbare tekens', 'node', ['scripts/verify/check-source-chars.mjs']],
  ['test', 'npm', ['run', 'test']],
  // Integratietests hebben een aparte *_test database nodig (TEST_DATABASE_URL); zonder die wordt de stap overgeslagen.
  ...(process.env.TEST_DATABASE_URL
    ? [['test:integration', 'npm', ['run', 'test:integration']]]
    : []),
  ['build', 'npm', ['run', 'build']],
  ['smoke gebouwde server', 'node', ['scripts/verify/smoke-built.mjs']],
  ['security audit', 'node', ['scripts/verify/audit-deps.mjs']],
];

const env = {
  ...process.env,
  DATABASE_URL: process.env.DATABASE_URL ?? 'mysql://x:x@localhost:3306/x',
};
for (const [name, cmd, args] of steps) {
  process.stdout.write(`\n▶ ${name}\n`);
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell: true, env });
  if (r.status !== 0) {
    console.error(`\n✖ verify gestopt: stap "${name}" faalde`);
    process.exit(r.status ?? 1);
  }
}
console.log('\n✔ verify geslaagd');
