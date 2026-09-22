import { z } from 'zod';

export const uploadLinkCreateSchema = z
  .object({
    campaign: z
      .string()
      .trim()
      .max(200)
      .transform((v) => (v === '' ? null : v))
      .nullable()
      .optional(),
    expiresInHours: z.coerce
      .number()
      .int()
      .min(1)
      .max(24 * 90)
      .optional(),
    maxUses: z.coerce.number().int().min(1).max(1000).nullable().optional(),
  })
  .strict();

export const brandProfileCreateSchema = z
  .object({
    data: z.record(z.string(), z.json()),
    activate: z.boolean().default(false),
  })
  .strict();

/** Formuliervelden van het publieke uploadformulier (multipart, dus alles als string binnen). */
export const publicUploadFormSchema = z
  .object({
    topic: z
      .string()
      .trim()
      .max(120)
      .transform((v) => (v === '' ? null : v))
      .nullable()
      .optional(),
    note: z
      .string()
      .trim()
      .max(4000)
      .transform((v) => (v === '' ? null : v))
      .nullable()
      .optional(),
    consent: z.literal('on', 'Bevestig dat u toestemming geeft'),
  })
  .strict();
