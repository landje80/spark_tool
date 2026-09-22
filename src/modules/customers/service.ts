import type { Prisma, PrismaClient } from '@prisma/client';
import { PROSPECT_WRITE_LOCK, withNamedLock } from '../../shared/database/lock.js';
import { AppError } from '../../shared/errors/app-error.js';
import { audit } from '../audit/audit.js';
import type { Actor } from '../../shared/security/actor.js';
import { canTransition } from '../prospects/status.js';
import type { ConvertProspect, CustomerCreate, CustomerUpdate } from './schemas.js';

export async function listCustomers(
  db: PrismaClient,
  q: { page: number; pageSize: number; q?: string; status?: string },
) {
  const where: Prisma.CustomerWhereInput = {
    ...(q.status ? { status: q.status as never } : {}),
    ...(q.q ? { name: { contains: q.q } } : {}),
  };
  const [total, items] = await Promise.all([
    db.customer.count({ where }),
    db.customer.findMany({
      where,
      orderBy: { name: 'asc' },
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
      select: {
        id: true,
        name: true,
        status: true,
        contactName: true,
        contactEmail: true,
        allowedPlatforms: true,
        createdAt: true,
        _count: { select: { submissions: true } },
      },
    }),
  ]);
  return { total, page: q.page, pageSize: q.pageSize, items };
}

export async function getCustomerDetail(db: PrismaClient, id: string) {
  const customer = await db.customer.findUnique({
    where: { id },
    include: {
      prospect: { select: { id: true, companyName: true } },
      brandProfiles: { orderBy: { version: 'desc' }, take: 10 },
      uploadLinks: {
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: {
          id: true,
          campaign: true,
          expiresAt: true,
          maxUses: true,
          useCount: true,
          revokedAt: true,
          createdAt: true,
        },
      },
      submissions: {
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: { id: true, status: true, topic: true, createdAt: true },
      },
    },
  });
  if (!customer) throw new AppError('NOT_FOUND', 'Klant niet gevonden');
  return customer;
}

export async function createCustomer(db: PrismaClient, actor: Actor, input: CustomerCreate) {
  const customer = await db.customer.create({
    data: {
      name: input.name,
      contactName: input.contactName ?? null,
      contactEmail: input.contactEmail ?? null,
      allowedPlatforms: input.allowedPlatforms,
      defaultTone: input.defaultTone ?? null,
    },
  });
  await audit(db, {
    actorId: actor.id,
    action: 'customer.create',
    entityType: 'Customer',
    entityId: customer.id,
    ip: actor.ip,
  });
  return customer;
}

export async function updateCustomer(
  db: PrismaClient,
  actor: Actor,
  id: string,
  input: CustomerUpdate,
) {
  const existing = await db.customer.findUnique({ where: { id } });
  if (!existing) throw new AppError('NOT_FOUND', 'Klant niet gevonden');
  const customer = await db.customer.update({
    where: { id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.contactName !== undefined ? { contactName: input.contactName } : {}),
      ...(input.contactEmail !== undefined ? { contactEmail: input.contactEmail } : {}),
      ...(input.allowedPlatforms !== undefined ? { allowedPlatforms: input.allowedPlatforms } : {}),
      ...(input.defaultTone !== undefined ? { defaultTone: input.defaultTone } : {}),
    },
  });
  await audit(db, {
    actorId: actor.id,
    action: 'customer.update',
    entityType: 'Customer',
    entityId: id,
    ip: actor.ip,
  });
  return customer;
}

/**
 * Zet een prospect om naar klant: maakt de Customer-rij aan en zet de prospectstatus op CUSTOMER,
 * atomair in één transactie. Een prospect kan maar één keer worden omgezet (uniek `prospectId`).
 */
export async function convertProspectToCustomer(
  db: PrismaClient,
  actor: Actor,
  prospectId: string,
  input: ConvertProspect,
) {
  // Zonder lock zouden twee gelijktijdige omzettingen van dezelfde prospect elkaars
  // Prospect-update kunnen raken en MySQL laten stuklopen op een write-conflict/deadlock in plaats
  // van een nette 409; dezelfde PROSPECT_WRITE_LOCK als bij andere identiteits-schrijfacties
  // (zie prospects/service.ts) serialiseert dat.
  return db.$transaction((tx) =>
    withNamedLock(tx, PROSPECT_WRITE_LOCK, async () => {
      const prospect = await tx.prospect.findUnique({ where: { id: prospectId } });
      if (!prospect || prospect.anonymizedAt) {
        throw new AppError('NOT_FOUND', 'Prospect niet gevonden');
      }
      if (prospect.status !== 'CUSTOMER' && !canTransition(prospect.status, 'CUSTOMER')) {
        throw new AppError(
          'INVALID_TRANSITION',
          `Overgang ${prospect.status} → CUSTOMER is niet toegestaan`,
        );
      }
      const existing = await tx.customer.findUnique({ where: { prospectId } });
      if (existing) throw new AppError('CONFLICT', 'Deze prospect is al omgezet naar klant');

      const customer = await tx.customer.create({
        data: {
          name: prospect.companyName,
          prospectId,
          contactName: input.contactName ?? null,
          contactEmail: input.contactEmail ?? prospect.contactEmail ?? null,
          allowedPlatforms: input.allowedPlatforms,
          defaultTone: input.defaultTone ?? null,
        },
      });
      if (prospect.status !== 'CUSTOMER') {
        await tx.prospect.update({ where: { id: prospectId }, data: { status: 'CUSTOMER' } });
        await tx.prospectActivity.create({
          data: {
            prospectId,
            type: 'CONVERTED_TO_CUSTOMER',
            actorId: actor.id,
            oldValue: prospect.status,
            newValue: 'CUSTOMER',
            description: 'Omgezet naar klant',
            metadata: { customerId: customer.id },
          },
        });
      }
      await audit(tx, {
        actorId: actor.id,
        action: 'customer.convert',
        entityType: 'Customer',
        entityId: customer.id,
        ip: actor.ip,
        metadata: { prospectId },
      });
      return customer;
    }),
  );
}
