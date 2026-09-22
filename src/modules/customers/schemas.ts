import { CustomerStatus, PublicationPlatform } from '@prisma/client';
import { z } from 'zod';

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional();

const allowedPlatforms = z.array(z.enum(PublicationPlatform)).min(1).max(4);

const shape = {
  contactName: text(200),
  contactEmail: z
    .email()
    .max(320)
    .or(z.literal('').transform(() => null))
    .nullable()
    .optional(),
  allowedPlatforms,
  defaultTone: text(4000),
};

export const customerCreateSchema = z
  .object({
    name: z.string().trim().min(1, 'Naam is verplicht').max(300),
    ...shape,
  })
  .strict();

export const customerUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(300),
    status: z.enum(CustomerStatus),
    ...shape,
  })
  .partial()
  .strict();

export const convertProspectSchema = z.object(shape).strict();

export const customerListQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).max(10_000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
    q: z.string().trim().max(200).optional(),
    status: z.enum(CustomerStatus).optional(),
  })
  .strict();

export type CustomerCreate = z.output<typeof customerCreateSchema>;
export type CustomerUpdate = z.output<typeof customerUpdateSchema>;
export type ConvertProspect = z.output<typeof convertProspectSchema>;
