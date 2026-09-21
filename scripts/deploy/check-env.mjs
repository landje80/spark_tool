// Controleert of de verplichte omgevingsvariabelen bestaan (zonder waarden te tonen).
import 'dotenv/config';

const REQUIRED = [
  'DATABASE_URL',
  'SESSION_SECRET',
  'APP_BASE_URL',
  'APP_BASE_PATH',
  'ENTRA_TENANT_ID',
  'ENTRA_CLIENT_ID',
  'ENTRA_CLIENT_SECRET',
  'ENTRA_REDIRECT_URI',
  'ENTRA_POST_LOGOUT_REDIRECT_URI',
];
const RECOMMENDED = [
  'POSTMARK_SERVER_TOKEN',
  'POSTMARK_FROM_EMAIL',
  'POSTMARK_WEBHOOK_SECRET',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_MODEL_LEAD_RESEARCH',
];

const placeholder = (v) => !v || /CHANGE_ME|^0{8}-0{4}/.test(v);
const missing = REQUIRED.filter((k) => placeholder(process.env[k]));
const notes = RECOMMENDED.filter((k) => placeholder(process.env[k]));

if (!process.env.ENTRA_ALLOWED_GROUP_IDS && !process.env.ENTRA_ALLOWED_USER_IDS) {
  missing.push('ENTRA_ALLOWED_GROUP_IDS of ENTRA_ALLOWED_USER_IDS');
}
if (notes.length)
  console.warn(`Let op, niet ingesteld (functies uitgeschakeld): ${notes.join(', ')}`);
if (missing.length) {
  console.error(`Ontbrekende of placeholder-variabelen: ${missing.join(', ')}`);
  process.exit(1);
}
console.log('deploy:check: verplichte variabelen aanwezig.');
