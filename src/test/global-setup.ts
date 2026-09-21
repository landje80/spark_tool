import 'dotenv/config';
import { spawnSync } from 'node:child_process';

/** Brengt de testdatabase op het actuele schema (idempotent). */
export default function globalSetup(): void {
  const url = process.env.TEST_DATABASE_URL;
  if (!url || !/_test$/.test(new URL(url).pathname.slice(1))) {
    throw new Error('TEST_DATABASE_URL ontbreekt of eindigt niet op _test');
  }
  const r = spawnSync('npx', ['prisma', 'migrate', 'deploy'], {
    shell: true,
    encoding: 'utf8',
    env: { ...process.env, DATABASE_URL: url },
  });
  if (r.status !== 0)
    throw new Error(`prisma migrate deploy faalde op testdatabase:\n${r.stdout}\n${r.stderr}`);
}
