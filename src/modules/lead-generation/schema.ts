import { z } from 'zod';

/**
 * Schema voor de gestructureerde uitvoer van het model (fase 2: extractie).
 * Bewust eenvoudig gehouden (geen min/max/regex) zodat het door de structured-outputs-schema-compiler
 * wordt geaccepteerd; de echte, strengere controle gebeurt daarna server-side in validate.ts.
 */
export const PLATFORMS = ['LINKEDIN', 'FACEBOOK', 'INSTAGRAM', 'TIKTOK'] as const;
export const SOURCE_TYPES = [
  'WEBSITE',
  'LINKEDIN',
  'FACEBOOK',
  'INSTAGRAM',
  'TIKTOK',
  'DIRECTORY',
  'NEWS',
  'OTHER',
] as const;
export const INDUSTRIES = [
  'horeca',
  'installatietechniek',
  'retail',
  'automotive',
  'zakelijke dienstverlening',
  'overig',
] as const;
export const PROVINCES = ['OVERIJSSEL', 'DRENTHE', 'GELDERLAND', 'FLEVOLAND', 'OTHER'] as const;

const SocialSchema = z.object({
  platform: z.enum(PLATFORMS),
  url: z.string(),
  accountName: z.string().nullable(),
  observations: z.array(z.string()),
});

const SourceSchema = z.object({
  type: z.enum(SOURCE_TYPES),
  url: z.string(),
  title: z.string().nullable(),
  observation: z.string().nullable(),
});

const ObservationSchema = z.object({
  /** 'waarneming' = feitelijk gezien; 'interpretatie' = conclusie van het model. */
  kind: z.enum(['waarneming', 'interpretatie']),
  text: z.string(),
});

export const CandidateSchema = z.object({
  companyName: z.string(),
  city: z.string(),
  province: z.enum(PROVINCES),
  industry: z.enum(INDUSTRIES),
  website: z.string(),
  phone: z.string().nullable(),
  contactEmail: z.string().nullable(),
  employeesMin: z.number().int().nullable(),
  employeesMax: z.number().int().nullable(),
  employeesRationale: z.string(),
  employeesSourceUrl: z.string().nullable(),
  socials: z.array(SocialSchema),
  observations: z.array(ObservationSchema),
  sparkFit: z.string(),
  outreachAngle: z.string(),
  fitScore: z.number().int(),
  sources: z.array(SourceSchema),
  confidence: z.enum(['LOW', 'MEDIUM', 'HIGH']),
  duplicateSignals: z.array(z.string()),
  researchedAt: z.string(),
});

export const ExtractionSchema = z.object({
  candidates: z.array(CandidateSchema),
  /** Onzekerheden of ontbrekende informatie die het team moet weten. */
  notes: z.string(),
});

export type Candidate = z.infer<typeof CandidateSchema>;
export type Extraction = z.infer<typeof ExtractionSchema>;
