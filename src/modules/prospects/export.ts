import type { PrismaClient } from '@prisma/client';
import { nl } from '../../shared/i18n/nl.js';
import { toCsv } from './csv.js';
import type { ListQuery } from './schemas.js';
import { buildWhere } from './service.js';

const MAX_ROWS = 5000;

export async function exportProspectsCsv(
  db: PrismaClient,
  q: ListQuery,
  tz: string,
  now = new Date(),
): Promise<string> {
  // Alleen de geëxporteerde kolommen ophalen (geen notities of onderbouwingen).
  const rows = await db.prospect.findMany({
    where: buildWhere(q, now, tz),
    orderBy: [{ [q.sort]: q.dir }, { id: 'asc' }],
    take: MAX_ROWS,
    select: {
      companyName: true,
      website: true,
      city: true,
      province: true,
      industry: true,
      employeesMin: true,
      employeesMax: true,
      fitScore: true,
      status: true,
      nextActionAt: true,
      createdAt: true,
      owner: { select: { name: true } },
    },
  });
  return toCsv(
    [
      'Bedrijfsnaam',
      'Website',
      'Plaats',
      'Provincie',
      'Branche',
      'Medewerkers min',
      'Medewerkers max',
      'Score',
      'Status',
      'Eigenaar',
      'Volgende actie',
      'Toegevoegd',
    ],
    rows.map((p) => [
      p.companyName,
      p.website,
      p.city,
      p.province,
      p.industry,
      p.employeesMin,
      p.employeesMax,
      p.fitScore,
      nl.status[p.status],
      p.owner?.name,
      p.nextActionAt,
      p.createdAt,
    ]),
  );
}
