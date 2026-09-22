import { Router, type Request } from 'express';
import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { requireAnyPermission, requirePermission } from '../auth/middleware.js';
import { parseInput } from '../../shared/validation/parse.js';
import type { Actor } from '../../shared/security/actor.js';
import {
  convertProspectSchema,
  customerCreateSchema,
  customerListQuerySchema,
  customerUpdateSchema,
} from './schemas.js';
import {
  convertProspectToCustomer,
  createCustomer,
  getCustomerDetail,
  listCustomers,
  updateCustomer,
} from './service.js';

const idParam = z.string().min(1).max(40);
const actorOf = (req: Request): Actor => ({ id: req.user!.id, ip: req.ip });
const READ = ['customer.manage', 'content.upload_link', 'content.review'] as const;

export function customersRouter(db: PrismaClient): Router {
  const r = Router();
  const read = requireAnyPermission(READ);
  const write = requirePermission('customer.manage');

  r.get('/customers', read, async (req, res) => {
    res.json(await listCustomers(db, parseInput(customerListQuerySchema, req.query)));
  });

  r.post('/customers', write, async (req, res) => {
    res
      .status(201)
      .json(await createCustomer(db, actorOf(req), parseInput(customerCreateSchema, req.body)));
  });

  r.get('/customers/:id', read, async (req, res) => {
    res.json(await getCustomerDetail(db, parseInput(idParam, req.params.id)));
  });

  r.patch('/customers/:id', write, async (req, res) => {
    const id = parseInput(idParam, req.params.id);
    res.json(
      await updateCustomer(db, actorOf(req), id, parseInput(customerUpdateSchema, req.body)),
    );
  });

  r.post('/prospects/:id/convert-to-customer', write, async (req, res) => {
    const id = parseInput(idParam, req.params.id);
    const input = parseInput(convertProspectSchema, req.body);
    res.status(201).json(await convertProspectToCustomer(db, actorOf(req), id, input));
  });

  return r;
}
