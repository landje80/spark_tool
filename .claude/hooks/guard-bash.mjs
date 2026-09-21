// PreToolUse(Bash): blokkeert gevaarlijke commando's. Exit 2 = blokkeren (stderr gaat naar Claude).
// Logt nooit de volledige opdracht (kan geheimen bevatten), alleen de reden.
import { readFileSync } from 'node:fs';

const input = JSON.parse(readFileSync(0, 'utf8') || '{}');
const cmd = String(input.tool_input?.command ?? '');

const RULES = [
  [/\brm\s+(-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r)\b/i, 'recursief verwijderen (rm -rf) is geblokkeerd'],
  [/\bRemove-Item\b[^\n]*-Recurse/i, 'Remove-Item -Recurse is geblokkeerd'],
  [/\bgit\s+push\b[^\n]*(--force|-f\b)/i, 'force-push is geblokkeerd'],
  [/\bgit\s+reset\s+--hard\b/i, 'git reset --hard is geblokkeerd'],
  [
    /\bgit\s+add\b[^\n]*(\.env(?!\.example)|\.pem|\.key|\.pfx|\.p12|\.crt|id_rsa|secret|token)/i,
    'geheime/sleutelbestanden mogen niet worden gestaged',
  ],
  [
    /\bgit\s+add\s+(-A|--all|\.)(\s|$)/i,
    'gebruik gerichte git add (voorkomt per ongeluk committen van geheimen)',
  ],
  [/\bprisma\s+migrate\s+reset\b/i, 'prisma migrate reset wist de database'],
  [/\bprisma\s+db\s+push\b[^\n]*--accept-data-loss/i, 'db push met dataverlies is geblokkeerd'],
  [/\b(DROP\s+(TABLE|DATABASE)|TRUNCATE\s+TABLE)\b/i, 'destructieve SQL is geblokkeerd'],
  [/curl[^\n|]*\|\s*(ba)?sh\b/i, 'pipe naar shell is geblokkeerd'],
  [
    /\b(cat|type|Get-Content)\s+[^\n]*\.env(?!\.example)\b/i,
    'geheime omgevingsbestanden niet uitlezen',
  ],
  [
    /\bdeploy\b[^\n]*(scripts[\\/]deploy)/i,
    'live deployment loopt alleen via Plesk na geslaagde verify',
  ],
];

for (const [re, reason] of RULES) {
  if (re.test(cmd)) {
    process.stderr.write(`Geblokkeerd door guard-bash: ${reason}\n`);
    process.exit(2);
  }
}
