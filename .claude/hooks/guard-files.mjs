// PreToolUse(Write|Edit): geen geheimenbestanden schrijven en geen destructieve migraties zonder herstelroute.
import { readFileSync } from 'node:fs';

const input = JSON.parse(readFileSync(0, 'utf8') || '{}');
const file = String(input.tool_input?.file_path ?? '').replace(/\\/g, '/');
const content = String(input.tool_input?.content ?? input.tool_input?.new_string ?? '');

if (/(^|\/)\.env(\.(?!example$)[^/]*)?$/.test(file) || /\.(pem|key|pfx|p12)$/.test(file)) {
  process.stderr.write(
    'Geblokkeerd: geheimen/sleutelbestanden worden niet door de agent geschreven.\n',
  );
  process.exit(2);
}

if (/prisma\/migrations\/.+\/migration\.sql$/.test(file)) {
  const destructive = /\b(DROP\s+(TABLE|COLUMN|DATABASE)|TRUNCATE)\b/i.test(content);
  const acknowledged = /--\s*DESTRUCTIVE-OK:/i.test(content);
  if (destructive && !acknowledged) {
    process.stderr.write(
      'Geblokkeerd: destructieve migratie. Gebruik expand/contract, of voeg "-- DESTRUCTIVE-OK: <back-up/herstelroute>" toe na menselijke goedkeuring.\n',
    );
    process.exit(2);
  }
}
