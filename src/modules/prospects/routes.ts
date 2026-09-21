import { Router, type Request } from 'express';
import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import type { Env } from '../../config/env.js';
import { requirePermission } from '../auth/middleware.js';
import { roleHas } from '../../shared/security/permissions.js';
import { parseInput } from '../../shared/validation/parse.js';
import { audit } from '../audit/audit.js';
import { bulkAssignOwner, bulkSetNextAction, mergeProspects } from './bulk.js';
import { getDashboard } from './dashboard.js';
import { exportProspectsCsv } from './export.js';
import {
  activityCreateSchema,
  bulkAssignSchema,
  bulkNextActionSchema,
  listQuerySchema,
  mergeSchema,
  prospectCreateSchema,
  prospectUpdateSchema,
  statusChangeSchema,
  taskCreateSchema,
  taskUpdateSchema,
} from './schemas.js';
import {
  addActivity,
  changeStatus,
  createProspect,
  getProspectDetail,
  listProspects,
  updateProspect,
  type Actor,
} from './service.js';
import { createTask, listTasks, updateTask } from './tasks.js';

const idParam = z.string().min(1).max(40);
const taskListSchema = z
  .object({
    status: z.enum(['OPEN', 'DONE', 'CANCELLED']).optional(),
    mine: z.enum(['true', 'false']).optional(),
  })
  .strict();

const actorOf = (req: Request): Actor => ({ id: req.user!.id, ip: req.ip });

/** CRM-API. Elke route heeft een expliciet recht; de router wordt pas na authenticatie + CSRF gemonteerd. */
export function crmRouter(env: Env, db: PrismaClient): Router {
  const r = Router();
  const tz = env.LEAD_GENERATION_TIMEZONE;
  const read = requirePermission('prospect.read');
  const write = requirePermission('prospect.write');

  r.get('/dashboard', read, async (_req, res) => {
    res.json(await getDashboard(db, tz));
  });

  r.get('/users', read, async (_req, res) => {
    const users = await db.user.findMany({
      where: { active: true },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
    res.json({ users });
  });

  r.get('/prospects', read, async (req, res) => {
    res.json(await listProspects(db, parseInput(listQuerySchema, req.query), tz));
  });

  r.get('/prospects/export.csv', requirePermission('prospect.export'), async (req, res) => {
    const q = parseInput(listQuerySchema, req.query);
    const csv = await exportProspectsCsv(db, q, tz);
    await audit(db, {
      actorId: req.user!.id,
      action: 'prospect.export',
      entityType: 'Prospect',
      ip: req.ip,
    });
    res
      .type('text/csv; charset=utf-8')
      .set('Content-Disposition', 'attachment; filename="prospects.csv"')
      .set('Cache-Control', 'no-store')
      .send(csv);
  });

  r.post('/prospects', write, async (req, res) => {
    const input = parseInput(prospectCreateSchema, req.body);
    res.status(201).json(await createProspect(db, actorOf(req), input));
  });

  r.post('/prospects/bulk/assign', write, async (req, res) => {
    const { ids, ownerId } = parseInput(bulkAssignSchema, req.body);
    res.json({ updated: await bulkAssignOwner(db, actorOf(req), ids, ownerId) });
  });

  r.post('/prospects/bulk/next-action', write, async (req, res) => {
    const { ids, nextActionAt } = parseInput(bulkNextActionSchema, req.body);
    res.json({ updated: await bulkSetNextAction(db, actorOf(req), ids, nextActionAt) });
  });

  r.get('/prospects/:id', read, async (req, res) => {
    res.json(await getProspectDetail(db, parseInput(idParam, req.params.id)));
  });

  r.patch('/prospects/:id', write, async (req, res) => {
    const id = parseInput(idParam, req.params.id);
    res.json(
      await updateProspect(db, actorOf(req), id, parseInput(prospectUpdateSchema, req.body)),
    );
  });

  r.post('/prospects/:id/status', write, async (req, res) => {
    const id = parseInput(idParam, req.params.id);
    const { status, reason } = parseInput(statusChangeSchema, req.body);
    res.json(await changeStatus(db, actorOf(req), id, status, reason));
  });

  r.post('/prospects/:id/activities', write, async (req, res) => {
    const id = parseInput(idParam, req.params.id);
    const { type, description } = parseInput(activityCreateSchema, req.body);
    res.status(201).json(await addActivity(db, actorOf(req), id, type, description));
  });

  r.post('/prospects/:id/tasks', write, async (req, res) => {
    const id = parseInput(idParam, req.params.id);
    res
      .status(201)
      .json(await createTask(db, actorOf(req), id, parseInput(taskCreateSchema, req.body)));
  });

  // Samenvoegen is niet omkeerbaar: alleen managers en beheerders.
  r.post('/prospects/:id/merge', requirePermission('prospect.merge'), async (req, res) => {
    const id = parseInput(idParam, req.params.id);
    const { sourceId } = parseInput(mergeSchema, req.body);
    res.json(await mergeProspects(db, actorOf(req), id, sourceId));
  });

  r.get('/tasks', read, async (req, res) => {
    const q = parseInput(taskListSchema, req.query);
    res.json({
      tasks: await listTasks(
        db,
        { status: q.status, assigneeId: q.mine === 'true' ? req.user!.id : undefined },
        tz,
      ),
    });
  });

  r.patch('/tasks/:id', write, async (req, res) => {
    const id = parseInput(idParam, req.params.id);
    const canManageAll = roleHas(req.user!.role, 'prospect.merge');
    res.json(
      await updateTask(db, actorOf(req), id, parseInput(taskUpdateSchema, req.body), canManageAll),
    );
  });

  return r;
}
