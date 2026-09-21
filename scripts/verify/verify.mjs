// Voert alle kwaliteitscontroles uit; stopt bij de eerste fout. Gebruik: npm run verify
import { spawnSync } from 'node:child_process';

const steps = [
  ['format', 'npm', ['run', 'format:check']],
  ['lint', 'npm', ['run', 'lint']],
  ['typecheck', 'npm', ['run', 'typecheck']],
  ['prisma validate', 'npx', ['prisma', 'validate']],
  ['test', 'npm', ['run', 'test']],
  ['build', 'npm', ['run', 'build']],
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
