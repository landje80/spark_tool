import pino from 'pino';

const level = process.env.LOG_LEVEL ?? 'info';
const redact = {
  paths: [
    'req.headers.authorization',
    'req.headers.cookie',
    'res.headers["set-cookie"]',
    '*.token',
    '*.password',
    '*.secret',
    '*.apiKey',
    '*.client_secret',
  ],
  censor: '[REDACTED]',
};

// Optioneel extra bestand naast stdout. Onder Apache/Passenger bleek stdout/stderr-opvang in de
// praktijk onbetrouwbaar/ontraceerbaar (zelfs met de meest uitgebreide Apache- en
// Passenger-logniveaus bleef een falende requestafhandeling spoorloos) — LOG_FILE geeft de app
// een eigen, altijd-beschikbaar logbestand, onafhankelijk van wat de omringende infrastructuur
// wel of niet doorgeeft. Onset (leeg/ontbrekend) verandert niets aan het bestaande gedrag.
const destination = process.env.LOG_FILE
  ? pino.multistream([
      { stream: process.stdout },
      { stream: pino.destination({ dest: process.env.LOG_FILE, mkdir: true, sync: false }) },
    ])
  : undefined;

export const logger = destination
  ? pino({ level, base: { app: 'spark-tool' }, redact }, destination)
  : pino({ level, base: { app: 'spark-tool' }, redact });
