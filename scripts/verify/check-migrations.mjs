// Controleert dat elke migratiemap een migration.sql heeft die niet door .gitignore wordt genegeerd.
// (Een eerdere versie van .gitignore negeerde *.sql, waardoor migraties nooit in Git kwamen.)
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const root = 'prisma/migrations';
const problems = [];
for (const name of readdirSync(root)) {
  const dir = path.join(root, name);
  if (!statSync(dir).isDirectory()) continue;
  const sql = path.join(dir, 'migration.sql').replace(/\\/g, '/');
  if (!existsSync(sql)) {
    problems.push(`${dir}: migration.sql ontbreekt`);
    continue;
  }
  // Exit 0 = genegeerd (fout), 1 = niet genegeerd (goed).
  if (spawnSync('git', ['check-ignore', '-q', sql]).status === 0) {
    problems.push(`${sql}: wordt door .gitignore genegeerd`);
  }
  // Tabelnamen in kleine letters duiden op een migratie gegenereerd op een Windows-database;
  // op Linux (productie) zijn tabelnamen hoofdlettergevoelig en zou de migratie falen.
  const text = readFileSync(sql, 'utf8');
  for (const m of text.matchAll(/\b(?:ON|TABLE|REFERENCES)\s+`([a-z][a-z0-9]*)`/g)) {
    problems.push(
      `${sql}: tabelnaam "${m[1]}" is in kleine letters (modelnamen beginnen met een hoofdletter)`,
    );
  }
}
if (problems.length) {
  console.error(`Migratiecontrole mislukt:\n - ${problems.join('\n - ')}`);
  process.exit(1);
}
console.log('Migraties: alle migration.sql-bestanden bestaan en worden door Git gevolgd.');
