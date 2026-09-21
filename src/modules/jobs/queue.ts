import type { Job, PrismaClient, Prisma } from '@prisma/client';

export const MAX_BACKOFF_MS = 60 * 60 * 1000;
const BASE_BACKOFF_MS = 60 * 1000;
/** Een RUNNING-job die zo lang niet is afgerond, geldt als gecrasht en wordt opnieuw ingepland. */
const STALE_LOCK_MS = 120 * 60 * 1000; // moet groter zijn dan STALE_RUNNING_MS (90 min) van een leadrun

/** Begrensde exponentiële backoff: 1, 2, 4, ... minuten, maximaal 1 uur. */
export function backoffMs(attempt: number): number {
  return Math.min(BASE_BACKOFF_MS * 2 ** Math.max(0, attempt - 1), MAX_BACKOFF_MS);
}

export interface EnqueueInput {
  type: string;
  /** Zelfde type + dedupeKey wordt maar één keer ingepland (idempotent). */
  dedupeKey?: string;
  payload?: Prisma.InputJsonValue;
  runAt?: Date;
  maxAttempts?: number;
}

export async function enqueue(
  db: PrismaClient,
  input: EnqueueInput,
): Promise<{ job: Job; created: boolean }> {
  if (input.dedupeKey) {
    const existing = await db.job.findUnique({
      where: { type_dedupeKey: { type: input.type, dedupeKey: input.dedupeKey } },
    });
    if (existing) return { job: existing, created: false };
  }
  try {
    const job = await db.job.create({
      data: {
        type: input.type,
        dedupeKey: input.dedupeKey ?? null,
        payload: input.payload,
        runAt: input.runAt ?? new Date(),
        maxAttempts: input.maxAttempts ?? 5,
      },
    });
    return { job, created: true };
  } catch (err) {
    // Gelijktijdig aangemaakt door een andere worker: de unieke sleutel wint.
    if ((err as { code?: string }).code === 'P2002' && input.dedupeKey) {
      const job = await db.job.findUniqueOrThrow({
        where: { type_dedupeKey: { type: input.type, dedupeKey: input.dedupeKey } },
      });
      return { job, created: false };
    }
    throw err;
  }
}

/** Claimt de volgende uitvoerbare job atomair (een guarded update voorkomt dubbele uitvoering). */
export async function claimNext(
  db: PrismaClient,
  workerId: string,
  now: Date,
): Promise<Job | null> {
  // Vastgelopen (gecrashte) jobs: opnieuw inplannen, of DEAD als alle pogingen al zijn verbruikt.
  const stale = await db.job.findMany({
    where: { status: 'RUNNING', lockedAt: { lt: new Date(now.getTime() - STALE_LOCK_MS) } },
  });
  for (const s of stale) {
    const exhausted = s.attempts >= s.maxAttempts;
    await db.job.updateMany({
      where: { id: s.id, status: 'RUNNING' },
      data: {
        status: exhausted ? 'DEAD' : 'PENDING',
        finishedAt: exhausted ? now : null,
        lockedAt: null,
        lockedBy: null,
        lastError: exhausted ? 'Vastgelopen: worker reageerde niet meer' : s.lastError,
      },
    });
  }
  const candidates = await db.job.findMany({
    where: { status: 'PENDING', runAt: { lte: now } },
    orderBy: { runAt: 'asc' },
    take: 5,
  });
  for (const c of candidates) {
    const res = await db.job.updateMany({
      where: { id: c.id, status: 'PENDING' },
      data: { status: 'RUNNING', lockedAt: now, lockedBy: workerId, attempts: { increment: 1 } },
    });
    if (res.count === 1) return db.job.findUniqueOrThrow({ where: { id: c.id } });
  }
  return null;
}

export async function completeJob(db: PrismaClient, id: string): Promise<void> {
  await db.job.update({
    where: { id },
    data: {
      status: 'SUCCEEDED',
      finishedAt: new Date(),
      lockedAt: null,
      lockedBy: null,
      lastError: null,
    },
  });
}

/** Mislukt: opnieuw met backoff, of DEAD (dead-letter) na het maximum aantal pogingen. */
export async function failJob(
  db: PrismaClient,
  job: Job,
  error: string,
  now: Date,
): Promise<'retry' | 'dead'> {
  const dead = job.attempts >= job.maxAttempts;
  await db.job.update({
    where: { id: job.id },
    data: {
      status: dead ? 'DEAD' : 'PENDING',
      runAt: dead ? job.runAt : new Date(now.getTime() + backoffMs(job.attempts)),
      finishedAt: dead ? now : null,
      lockedAt: null,
      lockedBy: null,
      lastError: error.slice(0, 2000),
    },
  });
  return dead ? 'dead' : 'retry';
}
