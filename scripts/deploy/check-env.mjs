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

// Spiegelt de productie-afdwingingen uit src/config/env.ts (parseEnv): dit script is de enige
// controle die vóór een deploy draait, dus moet exact dezelfde eisen stellen als de app zelf bij
// het opstarten zou afdwingen — anders kan een deploy slagen die de app bij een echte start alsnog
// laat weigeren (of, erger, een van de twee productie-veiligheidsmaatregelen mist zonder dat iets
// dat signaleert).
if (process.env.NODE_ENV !== 'production') {
  missing.push('NODE_ENV (moet exact "production" zijn voor een deploy)');
} else {
  try {
    if (new URL(process.env.APP_BASE_URL ?? '').protocol !== 'https:') {
      missing.push('APP_BASE_URL (moet https zijn in productie)');
    }
  } catch {
    missing.push('APP_BASE_URL (geen geldige URL)');
  }
}

if (notes.length)
  console.warn(`Let op, niet ingesteld (functies uitgeschakeld): ${notes.join(', ')}`);
if (missing.length) {
  console.error(`Ontbrekende, placeholder- of ongeldige variabelen: ${missing.join(', ')}`);
  process.exit(1);
}
console.log('deploy:check: verplichte variabelen aanwezig en productie-eisen voldaan.');
