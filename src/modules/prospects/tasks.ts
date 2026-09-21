import type { Prisma, PrismaClient, TaskStatus } from '@prisma/client';
import { AppError } from '../../shared/errors/app-error.js';
import { startOfNextDay } from '../../shared/time.js';
import { audit } from '../audit/audit.js';
import type { Actor } from './service.js';
import type { z } from 'zod';
import type { taskCreateSchema, taskUpdateSchema } from './schemas.js';

type TaskCreate = z.output<typeof taskCreateSchema>;
type TaskUpdate = z.output<typeof taskUpdateSchema>;

async function assertAssignee(db: Pick<PrismaClient, 'user'>, id?: string | null): Promise<void> {
  if (!id) return;
  const u = await db.user.findUnique({ where: { id }, select: { active: true } });
  if (!u?.active) {
    throw new AppError('VALIDATION_ERROR', 'Ongeldige invoer', [
      { path: 'assigneeId', message: 'Onbekende of inactieve gebruiker' },
    ]);
  }
}

export async function createTask(
  db: PrismaClient,
  actor: Actor,
  prospectId: string,
  input: TaskCreate,
) {
  const exists = await db.prospect.findUnique({
    where: { id: prospectId },
    select: { anonymizedAt: true },
  });
  if (!exists || exists.anonymizedAt) throw new AppError('NOT_FOUND', 'Prospect niet gevonden');
  await assertAssignee(db, input.assigneeId);
  return db.$transaction(async (tx) => {
    const task = await tx.task.create({
      data: { ...input, prospectId, assigneeId: input.assigneeId ?? actor.id },
    });
    await tx.prospectActivity.create({
      data: {
        prospectId,
        type: 'TASK_CREATED',
        actorId: actor.id,
        description: input.description ?? `Taak aangemaakt (${input.type})`,
      },
    });
    await audit(tx, {
      actorId: actor.id,
      action: 'task.create',
      entityType: 'Task',
      entityId: task.id,
      ip: actor.ip,
    });
    return task;
  });
}

/**
 * Zonder `canManageAll` mag een gebruiker alleen eigen of niet-toegewezen taken wijzigen;
 * managers en beheerders mogen alle taken wijzigen.
 */
export async function updateTask(
  db: PrismaClient,
  actor: Actor,
  id: string,
  input: TaskUpdate,
  canManageAll = false,
) {
  const existing = await db.task.findUnique({ where: { id }, select: { assigneeId: true } });
  if (!existing) throw new AppError('NOT_FOUND', 'Taak niet gevonden');
  if (!canManageAll && existing.assigneeId && existing.assigneeId !== actor.id) {
    throw new AppError('FORBIDDEN', 'Deze taak is aan iemand anders toegewezen');
  }
  await assertAssignee(db, input.assigneeId);
  const task = await db.task.update({ where: { id }, data: input });
  await audit(db, {
    actorId: actor.id,
    action: 'task.update',
    entityType: 'Task',
    entityId: id,
    ip: actor.ip,
    metadata: { fields: Object.keys(input) },
  });
  return task;
}

export interface TaskListFilter {
  status?: TaskStatus;
  assigneeId?: string;
  overdueBefore?: Date;
}

export async function listTasks(db: PrismaClient, f: TaskListFilter, tz: string, now = new Date()) {
  const where: Prisma.TaskWhereInput = {
    ...(f.status ? { status: f.status } : {}),
    ...(f.assigneeId ? { assigneeId: f.assigneeId } : {}),
  };
  const tasks = await db.task.findMany({
    where,
    orderBy: [{ status: 'asc' }, { dueAt: { sort: 'asc', nulls: 'last' } }, { priority: 'desc' }],
    take: 200,
    include: {
      prospect: { select: { id: true, companyName: true } },
      assignee: { select: { id: true, name: true } },
    },
  });
  const cutoff = startOfNextDay(now, tz);
  return tasks.map((t) => ({
    ...t,
    dueSoon: t.status === 'OPEN' && !!t.dueAt && t.dueAt < cutoff,
  }));
}
