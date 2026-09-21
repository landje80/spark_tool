import type { Prisma, PrismaClient, ProspectStatus } from '@prisma/client';
import { PROSPECT_WRITE_LOCK, withNamedLock } from '../../shared/database/lock.js';
import { AppError } from '../../shared/errors/app-error.js';
import { startOfDay, startOfNextDay } from '../../shared/time.js';
import { audit } from '../audit/audit.js';
import { findDuplicates, type CandidateIdentity, type DuplicateMatch } from './dedupe.js';
import {
  normalizeCompanyName,
  normalizeDomain,
  normalizePhone,
  normalizeSocialUrl,
} from './normalize.js';
import type { ListQuery, ProspectCreate, ProspectUpdate } from './schemas.js';
import { allowedTransitions, assertTransition } from './status.js';

export interface Actor {
  id: string;
  ip?: string | null;
}

/** Statussen waarin geen opvolging meer nodig is (dus nooit "achterstallig"). */
export const CLOSED_STATUSES: readonly ProspectStatus[] = [
  'NOT_INTERESTED',
  'REPLY_NOT_INTERESTED',
  'CUSTOMER',
  'ARCHIVED',
  'INVALID',
  'DUPLICATE',
];
const REVIEW_STATUSES: readonly ProspectStatus[] = ['NEW', 'IN_REVIEW'];

const trunc = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const s = v instanceof Date ? v.toISOString() : String(v);
  return s.length > 480 ? `${s.slice(0, 477)}...` : s;
};

function assertEmployees(min: number | null | undefined, max: number | null | undefined): void {
  if (min != null && max != null && min > max) {
    throw new AppError('VALIDATION_ERROR', 'Ongeldige invoer', [
      { path: 'employeesMax', message: 'Maximum moet groter of gelijk zijn aan minimum' },
    ]);
  }
}

async function assertActiveUser(db: Pick<PrismaClient, 'user'>, userId: string): Promise<void> {
  const u = await db.user.findUnique({ where: { id: userId }, select: { active: true } });
  if (!u?.active) {
    throw new AppError('VALIDATION_ERROR', 'Ongeldige invoer', [
      { path: 'ownerId', message: 'Onbekende of inactieve gebruiker' },
    ]);
  }
}

/**
 * Zoekt duplicaten via geïndexeerde kandidaatqueries (exact op domein/KvK/telefoon/social-URL en op
 * begin/einde van de genormaliseerde naam), begrensd op 500 kandidaten; daarna beslist `findDuplicates`.
 * Social-URL's worden exact vergeleken; nieuwe SocialProfile-rijen moeten dus genormaliseerd worden opgeslagen.
 */
export async function findMatches(
  db: Pick<Prisma.TransactionClient, 'prospect'>,
  candidate: CandidateIdentity,
  excludeId?: string,
): Promise<DuplicateMatch[]> {
  const name = normalizeCompanyName(candidate.companyName);
  const domain = normalizeDomain(candidate.website);
  const phone = normalizePhone(candidate.phone);
  const socials = (candidate.socialUrls ?? [])
    .map(normalizeSocialUrl)
    .filter((u): u is string => !!u);

  const or: Prisma.ProspectWhereInput[] = [];
  if (domain) or.push({ domain });
  if (candidate.kvkNumber) or.push({ kvkNumber: candidate.kvkNumber });
  if (phone) or.push({ phone });
  if (socials.length) or.push({ socials: { some: { url: { in: socials } } } });
  if (name.length >= 3) {
    or.push({ normalizedName: { startsWith: name.slice(0, 3) } });
    or.push({ normalizedName: { endsWith: name.slice(-3) } });
  }
  if (or.length === 0) return [];

  const rows = await db.prospect.findMany({
    where: { OR: or, ...(excludeId ? { id: { not: excludeId } } : {}) },
    take: 500,
    select: {
      id: true,
      companyName: true,
      domain: true,
      city: true,
      phone: true,
      kvkNumber: true,
      socials: { select: { url: true } },
    },
  });
  return findDuplicates(
    candidate,
    rows.map((r) => ({ ...r, socialUrls: r.socials.map((s) => s.url) })),
  );
}

async function duplicateConflict(
  db: Pick<Prisma.TransactionClient, 'prospect'>,
  matches: DuplicateMatch[],
  blocking: boolean,
): Promise<AppError> {
  const names = await db.prospect.findMany({
    where: { id: { in: matches.map((m) => m.prospectId) } },
    select: { id: true, companyName: true, city: true, status: true },
  });
  return new AppError('CONFLICT', 'Mogelijk duplicaat', {
    blocking,
    matches: matches.map((m) => ({ ...m, prospect: names.find((n) => n.id === m.prospectId) })),
  });
}

export async function createProspect(db: PrismaClient, actor: Actor, input: ProspectCreate) {
  const { confirmDuplicate, ...data } = input;
  assertEmployees(data.employeesMin, data.employeesMax);
  const normalizedName = normalizeCompanyName(data.companyName);
  if (!normalizedName) {
    throw new AppError('VALIDATION_ERROR', 'Ongeldige invoer', [
      { path: 'companyName', message: 'Bedrijfsnaam bevat geen bruikbare tekens' },
    ]);
  }
  if (data.ownerId) await assertActiveUser(db, data.ownerId);

  // Controle + insert onder één lock: twee gelijktijdige aanmaakacties kunnen elkaar niet passeren.
  return db.$transaction(
    (tx) =>
      withNamedLock(tx, PROSPECT_WRITE_LOCK, async () => {
        const matches = await findMatches(tx, {
          companyName: data.companyName,
          website: data.website,
          city: data.city,
          phone: data.phone,
          kvkNumber: data.kvkNumber,
        });
        const exact = matches.some((m) => m.kind === 'exact');
        if (exact || (matches.length > 0 && !confirmDuplicate)) {
          throw await duplicateConflict(tx, matches, exact);
        }
        const prospect = await tx.prospect.create({
          data: {
            ...data,
            normalizedName,
            domain: normalizeDomain(data.website),
            phone: normalizePhone(data.phone) ?? data.phone ?? null,
          },
        });
        await tx.prospectActivity.create({
          data: {
            prospectId: prospect.id,
            type: 'CREATED',
            actorId: actor.id,
            description: 'Prospect handmatig toegevoegd',
          },
        });
        await audit(tx, {
          actorId: actor.id,
          action: 'prospect.create',
          entityType: 'Prospect',
          entityId: prospect.id,
          ip: actor.ip,
        });
        return prospect;
      }),
    { timeout: 30_000 },
  );
}

const TRACKED: (keyof ProspectUpdate)[] = [
  'companyName',
  'website',
  'phone',
  'kvkNumber',
  'city',
  'province',
  'industry',
  'employeesMin',
  'employeesMax',
  'employeesRationale',
  'employeesSourceUrl',
  'fitScore',
  'fitRationale',
  'outreachAngle',
  'contactEmail',
  'notes',
  'ownerId',
  'nextActionAt',
  'notInterestedReason',
];
/** Velden die bepalen of iets een duplicaat is; wijziging daarvan triggert de duplicaatcontrole. */
const IDENTITY_FIELDS = ['companyName', 'website', 'phone', 'kvkNumber', 'city'];
/** Notities en onderbouwingen zijn lang; daarvan loggen we alleen dát ze wijzigden. */
const LONG_FIELDS = new Set([
  'notes',
  'employeesRationale',
  'fitRationale',
  'outreachAngle',
  'notInterestedReason',
]);

export async function updateProspect(
  db: PrismaClient,
  actor: Actor,
  id: string,
  input: ProspectUpdate,
) {
  if (input.ownerId) await assertActiveUser(db, input.ownerId);

  const run = async (tx: Prisma.TransactionClient) => {
    // Lezen en schrijven in dezelfde transactie: de wijzigingslog klopt met wat echt is opgeslagen.
    const existing = await tx.prospect.findUnique({ where: { id } });
    if (!existing || existing.anonymizedAt) {
      throw new AppError('NOT_FOUND', 'Prospect niet gevonden');
    }
    assertEmployees(
      input.employeesMin ?? existing.employeesMin,
      input.employeesMax ?? existing.employeesMax,
    );

    const changes: { field: string; oldValue: string | null; newValue: string | null }[] = [];
    for (const key of TRACKED) {
      if (!(key in input)) continue;
      const next = (input as Record<string, unknown>)[key] ?? null;
      const prev = (existing as Record<string, unknown>)[key] ?? null;
      const same =
        next instanceof Date || prev instanceof Date ? trunc(next) === trunc(prev) : next === prev;
      if (same) continue;
      const long = LONG_FIELDS.has(key);
      changes.push({
        field: key,
        oldValue: long ? null : trunc(prev),
        newValue: long ? null : trunc(next),
      });
    }
    if (changes.length === 0) return existing;

    if (changes.some((c) => IDENTITY_FIELDS.includes(c.field))) {
      const matches = (
        await findMatches(
          tx,
          {
            companyName: input.companyName ?? existing.companyName,
            website: 'website' in input ? input.website : existing.website,
            city: 'city' in input ? input.city : existing.city,
            phone: 'phone' in input ? input.phone : existing.phone,
            kvkNumber: 'kvkNumber' in input ? input.kvkNumber : existing.kvkNumber,
          },
          id,
        )
      ).filter((m) => m.kind === 'exact');
      if (matches.length) throw await duplicateConflict(tx, matches, true);
    }

    const data: Prisma.ProspectUncheckedUpdateInput = { ...input };
    if (input.companyName !== undefined) {
      data.normalizedName = normalizeCompanyName(input.companyName);
    }
    if ('website' in input) data.domain = normalizeDomain(input.website);
    if (input.phone) data.phone = normalizePhone(input.phone) ?? input.phone;

    const updated = await tx.prospect.update({ where: { id }, data });
    await tx.prospectActivity.createMany({
      data: changes.map((c) => ({
        prospectId: id,
        type: 'FIELD_CHANGED' as const,
        actorId: actor.id,
        description: `Veld gewijzigd: ${c.field}`,
        oldValue: c.oldValue,
        newValue: c.newValue,
      })),
    });
    await audit(tx, {
      actorId: actor.id,
      action: 'prospect.update',
      entityType: 'Prospect',
      entityId: id,
      ip: actor.ip,
      metadata: { fields: changes.map((c) => c.field) },
    });
    return updated;
  };

  const touchesIdentity = IDENTITY_FIELDS.some((k) => k in input);
  return db.$transaction(
    (tx) => (touchesIdentity ? withNamedLock(tx, PROSPECT_WRITE_LOCK, () => run(tx)) : run(tx)),
    { timeout: 30_000 },
  );
}

export async function changeStatus(
  db: PrismaClient,
  actor: Actor,
  id: string,
  to: ProspectStatus,
  reason?: string | null,
) {
  if (to === 'CUSTOMER') {
    throw new AppError('INVALID_TRANSITION', 'Klant worden loopt via de klantconversie');
  }
  return db.$transaction(async (tx) => {
    const p = await tx.prospect.findUnique({
      where: { id },
      select: { status: true, anonymizedAt: true },
    });
    if (!p || p.anonymizedAt) throw new AppError('NOT_FOUND', 'Prospect niet gevonden');
    if (p.status === to) return tx.prospect.findUniqueOrThrow({ where: { id } });
    assertTransition(p.status, to);

    // Alleen schrijven als de status nog gelijk is aan wat we lazen (voorkomt gelijktijdige, strijdige wijzigingen).
    const res = await tx.prospect.updateMany({
      where: { id, status: p.status },
      data: {
        status: to,
        archivedAt: to === 'ARCHIVED' ? new Date() : p.status === 'ARCHIVED' ? null : undefined,
        notInterestedReason:
          (to === 'NOT_INTERESTED' || to === 'REPLY_NOT_INTERESTED') && reason ? reason : undefined,
      },
    });
    if (res.count !== 1) {
      throw new AppError('CONFLICT', 'De status is inmiddels door iemand anders gewijzigd');
    }
    await tx.prospectActivity.create({
      data: {
        prospectId: id,
        type:
          to === 'ARCHIVED' ? 'ARCHIVED' : p.status === 'ARCHIVED' ? 'RESTORED' : 'STATUS_CHANGED',
        actorId: actor.id,
        description: reason ?? null,
        oldValue: p.status,
        newValue: to,
      },
    });
    await audit(tx, {
      actorId: actor.id,
      action: 'prospect.status',
      entityType: 'Prospect',
      entityId: id,
      ip: actor.ip,
      metadata: { from: p.status, to },
    });
    return tx.prospect.findUniqueOrThrow({ where: { id } });
  });
}

export async function addActivity(
  db: PrismaClient,
  actor: Actor,
  prospectId: string,
  type: 'NOTE' | 'CALL',
  description: string,
) {
  const p = await db.prospect.findUnique({
    where: { id: prospectId },
    select: { id: true, anonymizedAt: true },
  });
  if (!p || p.anonymizedAt) throw new AppError('NOT_FOUND', 'Prospect niet gevonden');
  return db.prospectActivity.create({
    data: { prospectId, type, actorId: actor.id, description },
  });
}

export function buildWhere(q: ListQuery, now: Date, tz: string): Prisma.ProspectWhereInput {
  const and: Prisma.ProspectWhereInput[] = [];
  if (!q.includeArchived && !q.status?.includes('ARCHIVED')) and.push({ archivedAt: null });
  and.push({ anonymizedAt: null });
  if (q.q) {
    and.push({
      OR: [
        { companyName: { contains: q.q } },
        { city: { contains: q.q } },
        { domain: { contains: q.q } },
        { industry: { contains: q.q } },
      ],
    });
  }
  if (q.status?.length) and.push({ status: { in: q.status } });
  if (q.ownerId) and.push(q.ownerId === 'none' ? { ownerId: null } : { ownerId: q.ownerId });
  if (q.province) and.push({ province: q.province });
  if (q.city) and.push({ city: q.city });
  if (q.industry) and.push({ industry: q.industry });
  if (q.addedFrom) and.push({ createdAt: { gte: startOfDay(q.addedFrom, tz) } });
  if (q.addedTo) and.push({ createdAt: { lt: startOfNextDay(q.addedTo, tz) } });
  if (q.nextActionFrom) and.push({ nextActionAt: { gte: startOfDay(q.nextActionFrom, tz) } });
  if (q.nextActionTo) and.push({ nextActionAt: { lt: startOfNextDay(q.nextActionTo, tz) } });
  if (q.due === 'today') {
    and.push({ nextActionAt: { gte: startOfDay(now, tz), lt: startOfNextDay(now, tz) } });
    and.push({ status: { notIn: [...CLOSED_STATUSES] } });
  }
  if (q.due === 'overdue') {
    and.push({ nextActionAt: { lt: startOfDay(now, tz) } });
    and.push({ status: { notIn: [...CLOSED_STATUSES] } });
  }
  if (q.hasOutreach === true)
    and.push({ OR: [{ drafts: { some: {} } }, { emails: { some: {} } }] });
  if (q.hasOutreach === false) and.push({ drafts: { none: {} }, emails: { none: {} } });
  if (q.minScore !== undefined) and.push({ fitScore: { gte: q.minScore } });
  return { AND: and };
}

const listSelect = {
  id: true,
  companyName: true,
  city: true,
  province: true,
  industry: true,
  status: true,
  fitScore: true,
  nextActionAt: true,
  createdAt: true,
  owner: { select: { id: true, name: true } },
  drafts: { where: { status: 'DRAFT' as const }, select: { id: true }, take: 1 },
  emails: {
    where: {
      status: {
        in: ['BOUNCED', 'SPAM_COMPLAINT', 'FAILED'] as ('BOUNCED' | 'SPAM_COMPLAINT' | 'FAILED')[],
      },
    },
    select: { id: true },
    take: 1,
  },
} satisfies Prisma.ProspectSelect;

type ListRow = Prisma.ProspectGetPayload<{ select: typeof listSelect }>;

export function toListItem(row: ListRow, now: Date, tz: string) {
  const { drafts, emails, ...rest } = row;
  const open = !CLOSED_STATUSES.includes(row.status);
  const dayStart = startOfDay(now, tz);
  const dayEnd = startOfNextDay(now, tz);
  const due = row.nextActionAt;
  return {
    ...rest,
    flags: {
      dueToday: open && !!due && due >= dayStart && due < dayEnd,
      overdue: open && !!due && due < dayStart,
      needsReview: REVIEW_STATUSES.includes(row.status),
      draftReady: drafts.length > 0,
      blocked: emails.length > 0,
    },
  };
}

export async function listProspects(db: PrismaClient, q: ListQuery, tz: string, now = new Date()) {
  const where = buildWhere(q, now, tz);
  const orderBy: Prisma.ProspectOrderByWithRelationInput[] = [{ [q.sort]: q.dir }, { id: 'asc' }];
  const [total, rows] = await Promise.all([
    db.prospect.count({ where }),
    db.prospect.findMany({
      where,
      select: listSelect,
      orderBy,
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    }),
  ]);
  return {
    total,
    page: q.page,
    pageSize: q.pageSize,
    items: rows.map((r) => toListItem(r, now, tz)),
  };
}

export async function getProspectDetail(db: PrismaClient, id: string) {
  const p = await db.prospect.findUnique({
    where: { id },
    include: {
      owner: { select: { id: true, name: true } },
      sources: { orderBy: { checkedAt: 'desc' } },
      socials: true,
      tasks: {
        orderBy: [{ status: 'asc' }, { dueAt: 'asc' }],
        include: { assignee: { select: { id: true, name: true } } },
      },
      activities: {
        orderBy: { createdAt: 'desc' },
        take: 100,
        include: { actor: { select: { id: true, name: true } } },
      },
      drafts: {
        orderBy: { createdAt: 'desc' },
        select: { id: true, subject: true, status: true, createdAt: true },
      },
      emails: {
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: { id: true, subject: true, status: true, sentAt: true, toEmail: true },
      },
      customer: { select: { id: true } },
    },
  });
  if (!p || p.anonymizedAt) throw new AppError('NOT_FOUND', 'Prospect niet gevonden');
  return { ...p, allowedTransitions: allowedTransitions(p.status).filter((s) => s !== 'CUSTOMER') };
}
