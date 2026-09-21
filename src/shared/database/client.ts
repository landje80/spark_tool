import { PrismaClient } from '@prisma/client';

let client: PrismaClient | undefined;

export function getDb(): PrismaClient {
  client ??= new PrismaClient({ log: ['warn', 'error'] });
  return client;
}
