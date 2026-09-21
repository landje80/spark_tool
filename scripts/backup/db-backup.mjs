// Maakt een gecomprimeerde mysqldump buiten de repository. Wachtwoord gaat via MYSQL_PWD, nooit via argumenten/logs.
import 'dotenv/config';
import { spawn } from 'node:child_process';
import { createWriteStream, mkdirSync } from 'node:fs';
import path from 'node:path';
import { createGzip } from 'node:zlib';

const raw = process.env.DATABASE_URL;
if (!raw) {
  console.error('DATABASE_URL ontbreekt');
  process.exit(1);
}
const url = new URL(raw);
const dir = path.resolve(process.env.BACKUP_DIR ?? '../spark-backups');
mkdirSync(dir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const file = path.join(dir, `spark_tool-${stamp}.sql.gz`);

const dump = spawn(
  'mysqldump',
  [
    '--single-transaction',
    '--routines',
    `--host=${url.hostname}`,
    `--port=${url.port || 3306}`,
    `--user=${decodeURIComponent(url.username)}`,
    url.pathname.slice(1),
  ],
  {
    env: { ...process.env, MYSQL_PWD: decodeURIComponent(url.password) },
    stdio: ['ignore', 'pipe', 'inherit'],
  },
);
dump.on('error', (e) => {
  console.error(`mysqldump niet uitvoerbaar: ${e.message}`);
  process.exit(1);
});
dump.stdout.pipe(createGzip()).pipe(createWriteStream(file, { mode: 0o600 }));
dump.on('close', (code) => {
  if (code !== 0) {
    console.error(`mysqldump faalde (exit ${code}); back-up ongeldig`);
    process.exit(1);
  }
  console.log(`Back-up geschreven: ${file}`);
});
