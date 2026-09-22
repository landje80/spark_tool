import { z } from 'zod';

const bool = z.enum(['true', 'false']).transform((v) => v === 'true');
const csv = z
  .string()
  .default('')
  .transform((v) =>
    v
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  APP_BASE_URL: z.url().default('http://localhost:3000'),
  APP_BASE_PATH: z
    .string()
    .regex(/^\/[a-z0-9/_-]*$/, 'APP_BASE_PATH moet met / beginnen, bv. /tool')
    .default('/tool')
    .transform((v) => (v.length > 1 ? v.replace(/\/+$/, '') : '')),
  DATABASE_URL: z.string().min(1),
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET moet minimaal 32 tekens zijn'),
  SESSION_COOKIE_NAME: z.string().default('spark.sid'),

  ENTRA_TENANT_ID: z.string().min(1),
  ENTRA_CLIENT_ID: z.string().min(1),
  ENTRA_CLIENT_SECRET: z.string().min(1),
  ENTRA_REDIRECT_URI: z.url(),
  ENTRA_POST_LOGOUT_REDIRECT_URI: z.url(),
  ENTRA_ALLOWED_GROUP_IDS: csv,
  ENTRA_ALLOWED_USER_IDS: csv,

  POSTMARK_SERVER_TOKEN: z.string().optional(),
  POSTMARK_FROM_EMAIL: z.email().optional(),
  POSTMARK_FROM_NAME: z.string().default('Spark'),
  POSTMARK_MESSAGE_STREAM: z.string().default('outbound'),
  // Basic Auth-wachtwoord voor de webhook; kort genoeg is te raden/brute-forcen (Postmark biedt geen HMAC).
  // Leeg/ontbrekend betekent "nog niet geconfigureerd" (zie mailConfigured); alleen een ingevulde waarde
  // wordt op lengte gecontroleerd.
  POSTMARK_WEBHOOK_SECRET: z
    .string()
    .optional()
    .refine((v) => !v || v.length >= 32, 'moet minimaal 32 tekens zijn'),
  POSTMARK_INBOUND_DOMAIN: z.string().optional(),

  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL_LEAD_RESEARCH: z.string().optional(),
  ANTHROPIC_MODEL_CONTENT: z.string().optional(),
  ANTHROPIC_MAX_DAILY_COST: z.coerce.number().positive().default(5),
  ANTHROPIC_WEB_SEARCH_MAX_USES: z.coerce.number().int().min(1).max(100).default(20),

  LEAD_GENERATION_TIMEZONE: z.string().default('Europe/Amsterdam'),
  LEAD_GENERATION_DAILY_TARGET: z.coerce.number().int().min(1).max(25).default(10),
  LEAD_GENERATION_CRON_SECRET: z.string().min(24).optional(),

  UPLOAD_STORAGE_DRIVER: z.enum(['local']).default('local'),
  UPLOAD_PRIVATE_PATH: z.string().default('./storage/private'),
  UPLOAD_MAX_IMAGE_MB: z.coerce.number().positive().default(25),
  UPLOAD_MAX_VIDEO_MB: z.coerce.number().positive().default(300),
  UPLOAD_TOKEN_TTL_HOURS: z.coerce.number().positive().default(72),

  FFMPEG_PATH: z.string().optional(),
  SHARP_CONCURRENCY: z.coerce.number().int().min(1).max(8).default(1),

  LOG_LEVEL: z.enum(['silent', 'fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  AUDIT_LOG_RETENTION_DAYS: z.coerce.number().int().min(30).default(730),
  PROSPECT_RETENTION_DAYS: z.coerce.number().int().min(30).default(730),
  TRUST_PROXY: bool.default(true),
});

export type Env = z.infer<typeof schema>;

export function parseEnv(source: NodeJS.ProcessEnv): Env {
  const result = schema.safeParse(source);
  if (!result.success) {
    // Alleen veldnamen en boodschappen, nooit waarden (geheimen).
    const issues = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Ongeldige configuratie:\n${issues}`);
  }
  const env = result.data;
  if (env.NODE_ENV === 'production') {
    if (new URL(env.APP_BASE_URL).protocol !== 'https:') {
      throw new Error('APP_BASE_URL moet https zijn in productie');
    }
    if (env.ENTRA_ALLOWED_GROUP_IDS.length === 0 && env.ENTRA_ALLOWED_USER_IDS.length === 0) {
      throw new Error('Stel ENTRA_ALLOWED_GROUP_IDS of ENTRA_ALLOWED_USER_IDS in (default deny)');
    }
  }
  return env;
}

let cached: Env | undefined;
export function getEnv(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}
