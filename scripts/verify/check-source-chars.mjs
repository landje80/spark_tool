// Formatters (Prettier) kunnen unicode-escapes in broncode omzetten naar onzichtbare letterlijke tekens
// (NUL, BOM, stuurtekens), waardoor regexen of vergelijkingen stil van betekenis veranderen.
// Deze controle faalt daarop.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const ROOTS = ['src', 'scripts', 'prisma', '.claude'];
const EXT = new Set(['.ts', '.tsx', '.mjs', '.js', '.css']);
const SKIP = new Set(['node_modules', 'migrations', 'generated']);
const problems = [];

function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (EXT.has(path.extname(p))) scan(p);
  }
}

function scan(file) {
  const text = readFileSync(file, 'utf8');
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    const control = (c < 32 && c !== 9 && c !== 10 && c !== 13) || c === 127;
    if (control || c === 0xfeff || c === 0x200b || c === 0x2028 || c === 0x2029) {
      const line = text.slice(0, i).split('\n').length;
      problems.push(
        `${file}:${line}: onzichtbaar teken (U+${c.toString(16).toUpperCase().padStart(4, '0')})`,
      );
      break; // één melding per bestand is genoeg
    }
  }
}

for (const r of ROOTS) {
  try {
    walk(r);
  } catch {
    /* map bestaat niet */
  }
}
if (problems.length) {
  console.error(
    `Onzichtbare tekens in broncode (gebruik String.fromCharCode of een escape):\n - ${problems.join('\n - ')}`,
  );
  process.exit(1);
}
console.log('Broncode: geen onzichtbare stuurtekens gevonden.');
