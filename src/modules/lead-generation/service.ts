import type { LeadGenerationRun, Prisma, PrismaClient, RunStatus } from '@prisma/client';
import { estimateCostUsd } from '../../integrations/anthropic/cost.js';
import {
  addUsage,
  emptyUsage,
  type LeadResearchClient,
  type ResearchResult,
  type Usage,
} from '../../integrations/anthropic/types.js';
import { PROSPECT_WRITE_LOCK, withNamedLock } from '../../shared/database/lock.js';
import { AppError } from '../../shared/errors/app-error.js';
import { safeError } from '../../shared/errors/safe-error.js';
import { logger } from '../../shared/logging/logger.js';
import { startOfDay } from '../../shared/time.js';
import { audit } from '../audit/audit.js';
import { findMatches } from '../prospects/service.js';
import { createProspectFromLead } from './persist.js';
import {
  buildExtractUserPrompt,
  buildResearchUserPrompt,
  ensurePromptVersion,
  EXTRACT_SYSTEM_PROMPT,
  RESEARCH_SYSTEM_PROMPT,
  SEARCH_RINGS,
  SPARK_SITE,
} from './prompt.js';
import { ExtractionSchema } from './schema.js';
import { validateCandidate } from './validate.js';

export interface LeadGenConfig {
  model: string;
  dailyTarget: number;
  maxDailyCost: number;
  maxSearches: number;
  timezone: string;
}

export interface LeadGenDeps {
  db: PrismaClient;
  client: LeadResearchClient;
  config: LeadGenConfig;
  now?: () => Date;
}

type SkipReason = 'already_done' | 'already_running' | 'budget_exceeded' | 'target_met';

export type RunOutcome =
  | { status: 'skipped'; reason: SkipReason }
  | {
      status: 'finished';
      runId: string;
      runStatus: RunStatus;
      accepted: number;
      duplicates: number;
      review: number;
      rejected: number;
      costUsd: number;
    };

/** Een RUNNING-run ouder dan dit geldt als gecrasht (moet kleiner zijn dan de job-stale-tijd in queue.ts). */
export const STALE_RUNNING_MS = 90 * 60 * 1000;
const LEADGEN_CLAIM_LOCK = 'spark:leadgen-claim';
const RESEARCH_MAX_TOKENS = 32_000;
const EXTRACT_MAX_TOKENS = 32_000;
/** Forfaitaire kostenpost als een betaalde aanroep faalt zonder dat we het verbruik kennen (timeout, crash). */
const FAILED_CALL_PENALTY_USD = 0.25;
/** Zoek pas een ruimere ring als de huidige ring al zoveel prospects per plaats bevat. */
const PER_PLACE_SATURATION = 12;

const ymd = (d: Date, tz: string): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(d);

/**
 * Foutmelding voor opslag en weergave. Prisma-fouten bevatten queryargumenten (bedrijfsgegevens) en worden
 * daarom teruggebracht tot naam + code; API-sleutels en autorisatieheaders worden altijd gemaskeerd.
 */
export async function spentToday(
  db: Pick<Prisma.TransactionClient, 'leadGenerationRun'>,
  tz: string,
  now: Date,
): Promise<number> {
  const agg = await db.leadGenerationRun.aggregate({
    where: { startedAt: { gte: startOfDay(now, tz) } },
    _sum: { estimatedCostUsd: true },
  });
  return Number(agg._sum.estimatedCostUsd ?? 0);
}

/** Kiest de eerste zoekring waarvan de plaatsen nog niet verzadigd zijn met prospects. */
export async function pickRing(db: PrismaClient): Promise<readonly string[]> {
  for (const ring of SEARCH_RINGS.slice(0, -1)) {
    const existing = await db.prospect.count({ where: { city: { in: [...ring] } } });
    if (existing < PER_PLACE_SATURATION * ring.length) return ring;
  }
  return SEARCH_RINGS[SEARCH_RINGS.length - 1]!;
}

async function bumpRun(
  db: PrismaClient,
  runId: string,
  usage: Usage,
  costUsd: number,
): Promise<void> {
  // Bewust lezen + schrijven i.p.v. `increment`: de kolom is nullable en NULL + x blijft NULL in SQL,
  // waardoor kosten (en dus de dagbudgetbewaking) stil zouden ontbreken. Eén schrijver per run (zie claimRun).
  const current = await db.leadGenerationRun.findUniqueOrThrow({
    where: { id: runId },
    select: { estimatedCostUsd: true },
  });
  await db.leadGenerationRun.update({
    where: { id: runId },
    data: {
      inputTokens: { increment: usage.inputTokens },
      outputTokens: { increment: usage.outputTokens },
      webSearchRequests: { increment: usage.webSearchRequests },
      estimatedCostUsd: Number(current.estimatedCostUsd ?? 0) + costUsd,
    },
  });
}

async function addRunUsage(
  db: PrismaClient,
  runId: string,
  model: string,
  usage: Usage,
): Promise<number> {
  const cost = estimateCostUsd(model, usage);
  await bumpRun(db, runId, usage, cost);
  return cost;
}

type Claim = { skip: SkipReason } | { skip: null; run: LeadGenerationRun; target: number };

/**
 * Claimt de run atomair onder een named lock: maximaal één actieve run tegelijk. Dat voorkomt dat twee workers
 * dezelfde run hervatten (dubbele Anthropic-kosten) en dat een handmatige en een dagelijkse run tegelijk door de
 * budgetcontrole glippen. Een RUNNING-run ouder dan STALE_RUNNING_MS geldt als gecrasht en mag worden overgenomen.
 */
async function claimRun(
  deps: LeadGenDeps,
  opts: { trigger: 'daily' | 'manual'; actorId?: string | null },
  runKey: string,
  now: Date,
): Promise<Claim> {
  const { db, config } = deps;
  try {
    return await db.$transaction(
      (tx) =>
        withNamedLock(
          tx,
          LEADGEN_CLAIM_LOCK,
          async (): Promise<Claim> => {
            const existing = await tx.leadGenerationRun.findUnique({ where: { runKey } });
            if (existing?.status === 'SUCCEEDED') return { skip: 'already_done' };

            const active = await tx.leadGenerationRun.findFirst({
              where: {
                status: 'RUNNING',
                startedAt: { gt: new Date(now.getTime() - STALE_RUNNING_MS) },
              },
              select: { id: true },
            });
            if (active) return { skip: 'already_running' };

            const spent = await spentToday(tx, config.timezone, now);
            if (spent >= config.maxDailyCost) {
              logger.warn(
                { spent, cap: config.maxDailyCost },
                'Dagbudget Anthropic bereikt; leadrun overgeslagen',
              );
              return { skip: 'budget_exceeded' };
            }
            const target =
              opts.trigger === 'daily'
                ? config.dailyTarget - (existing?.acceptedCount ?? 0)
                : config.dailyTarget;
            if (target <= 0) return { skip: 'target_met' };

            const prompt = await ensurePromptVersion(tx);
            // startedAt = claimmoment: kosten na een hervatting tellen mee voor de dag waarop ze worden gemaakt,
            // en het geeft de stale-controle een betrouwbaar hartslagmoment.
            const run = existing
              ? await tx.leadGenerationRun.update({
                  where: { id: existing.id },
                  data: {
                    status: 'RUNNING',
                    startedAt: now,
                    errorMessage: null,
                    finishedAt: null,
                    model: config.model,
                    promptVersionId: prompt.id,
                  },
                })
              : await tx.leadGenerationRun.create({
                  data: {
                    runKey,
                    status: 'RUNNING',
                    startedAt: now,
                    model: config.model,
                    promptVersionId: prompt.id,
                  },
                });
            await audit(tx, {
              actorId: opts.actorId ?? null,
              action: 'lead.run.start',
              entityType: 'LeadGenerationRun',
              entityId: run.id,
              metadata: { trigger: opts.trigger },
            });
            return { skip: null, run, target };
          },
          5,
        ),
      { timeout: 30_000 },
    );
  } catch (err) {
    // Claimlock bezet: een andere worker claimt precies nu een run.
    if (err instanceof AppError && err.code === 'CONFLICT') return { skip: 'already_running' };
    throw err;
  }
}

/**
 * Voert één leadgeneratie-run uit. Idempotent per runKey (dagelijks: één succesvolle run per lokale dag);
 * veilig opnieuw te starten na een fout (bewaard onderzoek wordt hergebruikt, dus niet dubbel betaald);
 * verstuurt nooit e-mail. Gooit bij een technische fout (zodat de jobwachtrij opnieuw probeert) nadat de fout
 * op de run is vastgelegd.
 */
export async function runLeadGeneration(
  deps: LeadGenDeps,
  opts: { trigger: 'daily' | 'manual'; actorId?: string | null },
): Promise<RunOutcome> {
  const { db, client, config } = deps;
  const now = (deps.now ?? (() => new Date()))();
  const runKey =
    opts.trigger === 'daily' ? `daily-${ymd(now, config.timezone)}` : `manual-${now.getTime()}`;

  const claim = await claimRun(deps, opts, runKey, now);
  if (claim.skip) return { status: 'skipped', reason: claim.skip };
  const { run, target } = claim;
  const spent = await spentToday(db, config.timezone, now);

  const errors: string[] = [];
  const rejected: { name: string; reason: string }[] = [];
  let usage = emptyUsage();
  let totalCost = 0;

  /** Voert een betaalde aanroep uit; bij een fout zonder bekend verbruik boeken we een forfaitair bedrag. */
  const guarded = async <T>(fn: () => Promise<T>): Promise<T> => {
    try {
      return await fn();
    } catch (err) {
      totalCost += FAILED_CALL_PENALTY_USD;
      await bumpRun(db, run.id, emptyUsage(), FAILED_CALL_PENALTY_USD);
      throw err;
    }
  };

  try {
    // ── Fase 1: onderzoek met web search (hergebruik bewaard onderzoek na een eerdere mislukte poging) ──
    const savedMeta = (run.metadata ?? null) as {
      research?: { text: string; seenUrls: string[] };
    } | null;
    let research: ResearchResult;
    if (savedMeta?.research?.text) {
      research = {
        text: savedMeta.research.text,
        seenUrls: savedMeta.research.seenUrls ?? [],
        usage: emptyUsage(),
        stopReason: 'end_turn',
      };
    } else {
      const known = await db.prospect.findMany({
        where: { anonymizedAt: null },
        select: { domain: true, companyName: true },
        orderBy: { createdAt: 'desc' },
        take: 400,
      });
      const ring = await pickRing(db);
      research = await guarded(() =>
        client.research({
          model: config.model,
          system: RESEARCH_SYSTEM_PROMPT,
          user: buildResearchUserPrompt({
            target,
            ring,
            knownDomains: known.map((k) => k.domain).filter((d): d is string => !!d),
            knownNames: known.map((k) => k.companyName),
            now,
          }),
          maxSearches: config.maxSearches,
          maxTokens: RESEARCH_MAX_TOKENS,
          fetchDomain: new URL(SPARK_SITE).hostname,
          // Verbruik wordt per beurt geboekt (ook bij een latere crash) en het budget bewaakt de lus.
          onTurn: async (turn) => {
            usage = addUsage(usage, turn);
            totalCost += await addRunUsage(db, run.id, config.model, turn);
            return spent + totalCost < config.maxDailyCost;
          },
        }),
      );
      // Het betaalde onderzoek meteen bewaren: faalt de extractie, dan hoeft een retry niet opnieuw te betalen.
      await db.leadGenerationRun.update({
        where: { id: run.id },
        data: {
          metadata: {
            research: {
              text: research.text.slice(0, 100_000),
              seenUrls: research.seenUrls.slice(0, 1000),
              savedAt: now.toISOString(),
            },
          },
        },
      });
    }
    if (research.stopReason === 'pause_turn') {
      errors.push('Onderzoek is niet volledig afgerond (hervattingslimiet)');
    }
    if (research.stopReason === 'budget_stop') {
      errors.push('Onderzoek is gestopt omdat het dagbudget is bereikt');
    }

    // Extractie is goedkoop en verzilvert het onderzoek; alleen stoppen bij ruime overschrijding van het budget.
    if (spent + totalCost > config.maxDailyCost * 2) {
      throw new Error('Dagbudget ruim overschreden na onderzoek');
    }

    // ── Fase 2: gestructureerde extractie, strikt gevalideerd ──
    const extraction = await guarded(() =>
      client.extract({
        model: config.model,
        system: EXTRACT_SYSTEM_PROMPT,
        user: buildExtractUserPrompt({
          notes: research.text,
          seenUrls: research.seenUrls,
          target,
          now,
        }),
        schema: ExtractionSchema,
        maxTokens: EXTRACT_MAX_TOKENS,
      }),
    );
    usage = addUsage(usage, extraction.usage);
    totalCost += await addRunUsage(db, run.id, config.model, extraction.usage);
    const parsed = ExtractionSchema.safeParse(extraction.data);
    if (!parsed.success) throw new Error('Modeluitvoer voldoet niet aan het schema');

    // ── Kandidaten verwerken ──
    let accepted = 0;
    let duplicates = 0;
    let review = 0;
    for (const raw of parsed.data.candidates) {
      if (accepted >= target) break;
      const result = validateCandidate(raw, research.seenUrls);
      if (!result.ok) {
        rejected.push({ name: raw.companyName.slice(0, 120), reason: result.reason });
        continue;
      }
      const clean = result.candidate;
      try {
        const outcome = await db.$transaction(
          (tx) =>
            withNamedLock(tx, PROSPECT_WRITE_LOCK, async () => {
              const matches = await findMatches(tx, {
                companyName: clean.companyName,
                website: clean.website,
                city: clean.city,
                phone: clean.phone,
                socialUrls: clean.socials.map((s) => s.url),
              });
              if (matches.some((m) => m.kind === 'exact')) return 'duplicate' as const;
              if (matches.length > 0) {
                await tx.leadCandidate.create({
                  data: {
                    runId: run.id,
                    payload: clean as unknown as object,
                    matchedProspectId: matches[0]!.prospectId,
                    matchReason: matches[0]!.reason,
                  },
                });
                return 'review' as const;
              }
              await createProspectFromLead(tx, clean, { runId: run.id, now });
              return 'accepted' as const;
            }),
          { timeout: 30_000 },
        );
        if (outcome === 'duplicate') duplicates++;
        else if (outcome === 'review') review++;
        else accepted++;
      } catch (err) {
        // Eén mislukte kandidaat stopt de run niet; de fout wordt zichtbaar op de run.
        errors.push(`${clean.companyName.slice(0, 80)}: ${safeError(err)}`);
      }
    }

    const finalStatus: RunStatus = errors.length > 0 ? 'PARTIAL' : 'SUCCEEDED';
    await db.leadGenerationRun.update({
      where: { id: run.id },
      data: {
        status: finalStatus,
        finishedAt: new Date(),
        candidatesCount: { increment: parsed.data.candidates.length },
        acceptedCount: { increment: accepted },
        duplicateCount: { increment: duplicates },
        reviewCount: { increment: review },
        errorMessage: errors.length ? errors.join(' | ').slice(0, 2000) : null,
        metadata: {
          research: {
            text: research.text.slice(0, 100_000),
            seenUrls: research.seenUrls.slice(0, 1000),
          },
          rejected,
          notes: parsed.data.notes.slice(0, 2000),
          seenUrlCount: research.seenUrls.length,
          webFetchRequests: usage.webFetchRequests,
          researchStopReason: research.stopReason,
          target,
        },
      },
    });
    await audit(db, {
      actorId: opts.actorId ?? null,
      action: 'lead.run.finish',
      entityType: 'LeadGenerationRun',
      entityId: run.id,
      metadata: { status: finalStatus, accepted, duplicates, review },
    });
    return {
      status: 'finished',
      runId: run.id,
      runStatus: finalStatus,
      accepted,
      duplicates,
      review,
      rejected: rejected.length,
      costUsd: totalCost,
    };
  } catch (err) {
    await db.leadGenerationRun.update({
      where: { id: run.id },
      data: { status: 'FAILED', finishedAt: new Date(), errorMessage: safeError(err) },
    });
    throw err;
  }
}
