import { z } from 'zod';

export const draftEditSchema = z
  .object({
    text: z.string().trim().min(1, 'Tekst is verplicht').max(3000),
    hashtags: z.array(z.string().trim().max(50)).max(15).default([]),
    cta: z
      .string()
      .trim()
      .max(300)
      .transform((v) => (v === '' ? null : v))
      .nullable()
      .optional(),
    altText: z
      .string()
      .trim()
      .max(500)
      .transform((v) => (v === '' ? null : v))
      .nullable()
      .optional(),
  })
  .strict();

export const draftStatusSchema = z
  .object({
    to: z.enum(['IN_REVIEW', 'APPROVED', 'CHANGES_REQUESTED', 'DISCARDED']),
    feedback: z
      .string()
      .trim()
      .max(2000)
      .transform((v) => (v === '' ? null : v))
      .nullable()
      .optional(),
  })
  .strict();

export const submissionAdvanceSchema = z
  .object({ to: z.enum(['READY_TO_PUBLISH', 'ARCHIVED']) })
  .strict();

export const submissionListQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).max(10_000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
    status: z.string().max(40).optional(),
    customerId: z.string().max(40).optional(),
  })
  .strict();
