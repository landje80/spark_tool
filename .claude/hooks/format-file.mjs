// PostToolUse(Write|Edit): formatteert het gewijzigde bestand met Prettier. Faalt stil (informatief).
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

const input = JSON.parse(readFileSync(0, 'utf8') || '{}');
const file = String(input.tool_input?.file_path ?? '');
if (!file || !existsSync(file) || !/\.(ts|tsx|js|mjs|json|css|md|html)$/.test(file))
  process.exit(0);
if (/node_modules|package-lock\.json|prisma[\\/]migrations/.test(file)) process.exit(0);

spawnSync('npx', ['prettier', '--write', file], { shell: true, stdio: 'ignore' });
