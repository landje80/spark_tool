import type { PrismaClient, ProspectStatus } from '@prisma/client';
import { startOfDay, startOfNextDay } from '../../shared/time.js';
import { CLOSED_STATUSES } from './service.js';

/** Volgorde van de funnel; alleen stappen die een echte voortgang in het verkooptraject zijn. */
const FUNNEL: ProspectStatus[] = [
  'NEW',
  'OUTREACH_PREPARED',
  'EMAILED',
  'REPLY_RECEIVED',
  'QUALIFIED',
  'CUSTOMER',
];

async function distribution(db: PrismaClient, by: 'city' | 'province' | 'industry') {
  const rows = await db.prospect.groupBy({
    by: [by],
    where: { archivedAt: null, anonymizedAt: null },
    _count: { _all: true },
    // Tweede sortering maakt de top-12 deterministisch bij gelijke aantallen.
    orderBy: [
      { _count: { id: 'desc' } },
      by === 'city'
        ? { city: 'asc' }
        : by === 'province'
          ? { province: 'asc' }
          : { industry: 'asc' },
    ],
    take: 12,
  });
  return rows.map((r) => ({
    key: (r as Record<string, unknown>)[by] as string | null,
    count: r._count._all,
  }));
}

export async function getDashboard(db: PrismaClient, tz: string, now = new Date()) {
  const dayStart = startOfDay(now, tz);
  const dayEnd = startOfNextDay(now, tz);
  const open = { status: { notIn: [...CLOSED_STATUSES] }, archivedAt: null, anonymizedAt: null };
  const since = new Date(now.getTime() - 30 * 24 * 3600 * 1000);

  const [
    newCount,
    dueToday,
    overdue,
    draftsToReview,
    emailsSent,
    replies,
    runs,
    failedJobs,
    byStatus,
    byCity,
    byProvince,
    byIndustry,
  ] = await Promise.all([
    db.prospect.count({ where: { status: 'NEW', archivedAt: null } }),
    db.prospect.count({ where: { ...open, nextActionAt: { gte: dayStart, lt: dayEnd } } }),
    db.prospect.count({ where: { ...open, nextActionAt: { lt: dayStart } } }),
    db.outreachDraft.count({ where: { status: 'DRAFT' } }),
    db.emailMessage.count({ where: { sentAt: { gte: since } } }),
    db.prospect.count({ where: { status: 'REPLY_RECEIVED' } }),
    db.leadGenerationRun.findMany({
      orderBy: { startedAt: 'desc' },
      take: 5,
      select: {
        id: true,
        startedAt: true,
        finishedAt: true,
        status: true,
        acceptedCount: true,
        duplicateCount: true,
        reviewCount: true,
        errorMessage: true,
      },
    }),
    db.job.count({ where: { status: { in: ['DEAD', 'FAILED'] } } }),
    db.prospect.groupBy({ by: ['status'], where: { anonymizedAt: null }, _count: { _all: true } }),
    distribution(db, 'city'),
    distribution(db, 'province'),
    distribution(db, 'industry'),
  ]);

  const statusCounts = Object.fromEntries(
    byStatus.map((r) => [r.status, r._count._all]),
  ) as Partial<Record<ProspectStatus, number>>;
  return {
    kpis: { newCount, dueToday, overdue, draftsToReview, emailsSent, replies, failedJobs },
    funnel: FUNNEL.map((status) => ({ status, count: statusCounts[status] ?? 0 })),
    byStatus: byStatus.map((r) => ({ key: r.status, count: r._count._all })),
    byCity,
    byProvince,
    byIndustry,
    recentRuns: runs,
  };
}
