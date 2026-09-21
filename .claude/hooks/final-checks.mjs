// Stop-hook: typecheck, lint en build moeten slagen vóór afronding. Exit 2 = Claude moet doorgaan en herstellen.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

const input = JSON.parse(readFileSync(0, 'utf8') || '{}');
if (input.stop_hook_active || !existsSync('package.json')) process.exit(0); // voorkom lussen

const env = {
  ...process.env,
  DATABASE_URL: process.env.DATABASE_URL ?? 'mysql://x:x@localhost:3306/x',
};
for (const script of ['typecheck', 'lint', 'build']) {
  const r = spawnSync('npm', ['run', script, '--silent'], { shell: true, encoding: 'utf8', env });
  if (r.status !== 0) {
    const tail = `${r.stdout ?? ''}${r.stderr ?? ''}`.split('\n').slice(-25).join('\n');
    process.stderr.write(
      `Afronding geblokkeerd: "npm run ${script}" faalt. Herstel eerst.\n${tail}\n`,
    );
    process.exit(2);
  }
}
