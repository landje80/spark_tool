import type { Prisma, PrismaClient } from '@prisma/client';

export interface AuditEntry {
  actorId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  ip?: string | null;
  /** Nooit secrets of onnodige persoonsgegevens. */
  metadata?: Prisma.InputJsonValue;
}

export async function audit(db: Pick<PrismaClient, 'auditLog'>, entry: AuditEntry): Promise<void> {
  await db.auditLog.create({
    data: {
      actorId: entry.actorId ?? null,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      ip: entry.ip ?? null,
      metadata: entry.metadata ?? undefined,
    },
  });
}
