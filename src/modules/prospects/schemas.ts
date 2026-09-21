import {
  ActivityType,
  ProspectStatus,
  Province,
  TaskPriority,
  TaskStatus,
  TaskType,
} from '@prisma/client';
import { z } from 'zod';
import { normalizeDomain } from './normalize.js';

/** Lege string wordt null; alleen bedoeld voor optionele tekstvelden. */
const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional();

const website = z
  .string()
  .trim()
  .max(500)
  .refine((v) => v === '' || normalizeDomain(v) !== null, 'Ongeldige website')
  .transform((v) => (v === '' ? null : v))
  .nullable()
  .optional();

/** Datum (YYYY-MM-DD) of ISO-datumtijd. Alleen-datum wordt 12:00 UTC zodat de lokale dag klopt. */
export const dateInput = z
  .union([z.iso.datetime({ offset: true }), z.iso.date()])
  .transform((v) => (v.length === 10 ? new Date(`${v}T12:00:00Z`) : new Date(v)));

const csvList = <T extends z.ZodType>(item: T) =>
  z.preprocess(
    (v) => (typeof v === 'string' ? v.split(',').filter(Boolean) : v),
    z.array(item).max(20),
  );

const shape = {
  companyName: z.string().trim().min(1, 'Bedrijfsnaam is verplicht').max(300),
  website,
  phone: text(40),
  kvkNumber: z
    .string()
    .trim()
    .regex(/^\d{8}$/, 'KvK-nummer heeft 8 cijfers')
    .or(z.literal('').transform(() => null))
    .nullable()
    .optional(),
  city: text(120),
  province: z.enum(Province),
  industry: text(120),
  employeesMin: z.number().int().min(0).max(1_000_000).nullable().optional(),
  employeesMax: z.number().int().min(0).max(1_000_000).nullable().optional(),
  employeesRationale: text(4000),
  employeesSourceUrl: text(1000),
  fitScore: z.number().int().min(0).max(100).nullable().optional(),
  fitRationale: text(4000),
  outreachAngle: text(4000),
  contactEmail: z
    .email()
    .max(320)
    .or(z.literal('').transform(() => null))
    .nullable()
    .optional(),
  notes: text(10000),
  ownerId: z.string().min(1).max(40).nullable().optional(),
  nextActionAt: dateInput.nullable().optional(),
  notInterestedReason: text(2000),
};

export const prospectCreateSchema = z
  .object({
    ...shape,
    province: shape.province.default('OTHER'),
    confirmDuplicate: z.boolean().default(false),
  })
  .strict();

export const prospectUpdateSchema = z.object(shape).partial().strict();

export const statusChangeSchema = z
  .object({
    status: z.enum(ProspectStatus),
    reason: text(2000),
  })
  .strict();

export const activityCreateSchema = z
  .object({
    type: z.enum([ActivityType.NOTE, ActivityType.CALL]),
    description: z.string().trim().min(1, 'Omschrijving is verplicht').max(5000),
  })
  .strict();

export const taskCreateSchema = z
  .object({
    type: z.enum(TaskType).default('FOLLOW_UP'),
    assigneeId: z.string().min(1).max(40).nullable().optional(),
    dueAt: dateInput.nullable().optional(),
    priority: z.enum(TaskPriority).default('NORMAL'),
    description: text(2000),
  })
  .strict();

export const taskUpdateSchema = z
  .object({
    type: z.enum(TaskType),
    assigneeId: z.string().min(1).max(40).nullable(),
    dueAt: dateInput.nullable(),
    priority: z.enum(TaskPriority),
    status: z.enum(TaskStatus),
    description: text(2000),
  })
  .partial()
  .strict();

const ids = z.array(z.string().min(1).max(40)).min(1).max(200);
export const bulkAssignSchema = z
  .object({ ids, ownerId: z.string().min(1).max(40).nullable() })
  .strict();
export const bulkNextActionSchema = z.object({ ids, nextActionAt: dateInput.nullable() }).strict();
export const mergeSchema = z.object({ sourceId: z.string().min(1).max(40) }).strict();

export const SORT_FIELDS = [
  'companyName',
  'createdAt',
  'nextActionAt',
  'fitScore',
  'status',
  'city',
] as const;

const bool = z.preprocess((v) => (v === 'true' ? true : v === 'false' ? false : v), z.boolean());

export const listQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).max(10_000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
    q: z.string().trim().max(200).optional(),
    status: csvList(z.enum(ProspectStatus)).optional(),
    ownerId: z.string().max(40).optional(), // 'none' = niet toegewezen
    province: z.enum(Province).optional(),
    city: z.string().trim().max(120).optional(),
    industry: z.string().trim().max(120).optional(),
    addedFrom: dateInput.optional(),
    addedTo: dateInput.optional(),
    nextActionFrom: dateInput.optional(),
    nextActionTo: dateInput.optional(),
    due: z.enum(['today', 'overdue']).optional(),
    hasOutreach: bool.optional(),
    minScore: z.coerce.number().int().min(0).max(100).optional(),
    includeArchived: bool.default(false),
    sort: z.enum(SORT_FIELDS).default('createdAt'),
    dir: z.enum(['asc', 'desc']).default('desc'),
  })
  .strict();

export type ListQuery = z.output<typeof listQuerySchema>;
export type ProspectCreate = z.output<typeof prospectCreateSchema>;
export type ProspectUpdate = z.output<typeof prospectUpdateSchema>;
