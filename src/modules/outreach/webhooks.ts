import type { EmailMessage, Prisma, PrismaClient, ProspectStatus } from '@prisma/client';
import { z } from 'zod';
import { withNamedLock } from '../../shared/database/lock.js';
import { audit } from '../audit/audit.js';
import { canTransition } from '../prospects/status.js';
import { addSuppression, normalizeEmail } from './suppression.js';

type Db = Prisma.TransactionClient;

const HARD_BOUNCE_TYPES = new Set(['HardBounce', 'BadEmailAddress', 'ManuallyDeactivated']);
const OPT_OUT_RE =
  /\b(afmelden|uitschrijven|unsubscribe|stop\s+met\s+mailen|geen\s+e-?mail(?:s)?\s+meer|verwijder\s+mij)\b/i;
const AUTO_REPLY_SUBJECT_RE =
  /^(automatic reply|automatisch antwoord|out of office|afwezig|auto:)/i;

const base = z
  .object({
    RecordType: z.string().optional(),
    MessageID: z.string().max(100).optional(),
    Metadata: z.record(z.string(), z.string()).optional(),
  })
  .loose();

/** Selecteert wat we bewaren; volledige (gevoelige) mailbodies en bijlagen worden nooit opgeslagen. */
function storable(p: Record<string, unknown>): Record<string, unknown> {
  const keep = [
    'RecordType',
    'MessageID',
    'ID',
    'Type',
    'TypeCode',
    'Email',
    'Recipient',
    'BouncedAt',
    'DeliveredAt',
    'ReceivedAt',
    'Inactive',
    'MailboxHash',
    'SuppressSending',
    'SuppressionReason',
    'MessageStream',
  ];
  return Object.fromEntries(keep.filter((k) => k in p).map((k) => [k, p[k]]));
}

/** Uniek per providerevent, zodat een herhaalde aflevering (Postmark hertries) niets dubbel doet. */
export function externalKeyOf(p: Record<string, unknown>): { key: string; type: string } | null {
  const s = (v: unknown) => (typeof v === 'string' || typeof v === 'number' ? String(v) : '');
  const type = s(p.RecordType) || (p.FromFull && p.MessageID ? 'Inbound' : '');
  switch (type) {
    case 'Delivery':
      return { type, key: `Delivery:${s(p.MessageID)}:${s(p.DeliveredAt)}` };
    case 'Bounce':
      return { type, key: `Bounce:${s(p.ID) || `${s(p.MessageID)}:${s(p.BouncedAt)}`}` };
    case 'SpamComplaint':
      return { type, key: `Spam:${s(p.ID) || `${s(p.MessageID)}:${s(p.BouncedAt)}`}` };
    case 'Open':
      return { type, key: `Open:${s(p.MessageID)}:${s(p.ReceivedAt)}` };
    case 'Click':
      return {
        type,
        key: `Click:${s(p.MessageID)}:${s(p.ReceivedAt)}:${s(p.OriginalLink).slice(0, 60)}`,
      };
    case 'SubscriptionChange':
      return { type, key: `Sub:${s(p.MessageID)}:${s(p.ChangedAt)}:${s(p.Recipient)}` };
    case 'Inbound':
      return { type, key: `Inbound:${s(p.MessageID)}` };
    default:
      return null;
  }
}

async function findMessage(db: Db, p: z.infer<typeof base>): Promise<EmailMessage | null> {
  if (p.MessageID) {
    const byPm = await db.emailMessage.findUnique({ where: { postmarkMessageId: p.MessageID } });
    if (byPm) return byPm;
  }
  const ourId = p.Metadata?.emailMessageId;
  if (ourId) {
    const byId = await db.emailMessage.findUnique({ where: { id: ourId } });
    // Herstelt de koppeling als de registratie na verzending mislukte (postmarkMessageId ontbrak).
    if (byId && p.MessageID && !byId.postmarkMessageId) {
      return db.emailMessage.update({
        where: { id: byId.id },
        data: { postmarkMessageId: p.MessageID },
      });
    }
    return byId;
  }
  return null;
}

async function blockProspect(db: Db, prospectId: string | null, reason: string): Promise<void> {
  if (!prospectId) return;
  const p = await db.prospect.findUnique({ where: { id: prospectId }, select: { status: true } });
  if (p && canTransition(p.status, 'NOT_INTERESTED')) {
    await db.prospect.update({
      where: { id: prospectId },
      data: { status: 'NOT_INTERESTED', notInterestedReason: reason },
    });
    await db.prospectActivity.create({
      data: {
        prospectId,
        type: 'STATUS_CHANGED',
        oldValue: p.status,
        newValue: 'NOT_INTERESTED',
        description: reason,
      },
    });
  }
}

const note = (db: Db, prospectId: string | null, description: string) =>
  prospectId
    ? db.prospectActivity.create({
        data: { prospectId, type: 'NOTE', description: description.slice(0, 500) },
      })
    : Promise.resolve(null);

async function onDelivery(
  db: Db,
  p: z.infer<typeof base>,
  raw: Record<string, unknown>,
  now: Date,
) {
  const m = await findMessage(db, p);
  if (!m || !['QUEUED', 'SENT'].includes(m.status)) return;
  await db.emailMessage.update({
    where: { id: m.id },
    data: {
      status: 'DELIVERED',
      deliveredAt: raw.DeliveredAt ? new Date(String(raw.DeliveredAt)) : now,
      sentAt: m.sentAt ?? now,
      postmarkMessageId: m.postmarkMessageId ?? p.MessageID ?? null,
    },
  });
}

async function onBounce(
  db: Db,
  p: z.infer<typeof base>,
  raw: Record<string, unknown>,
  spam: boolean,
) {
  const m = await findMessage(db, p);
  // Een spamklacht is een definitief eindoordeel; een latere (soft)bounce mag dat detail niet overschrijven.
  if (m?.status === 'SPAM_COMPLAINT') return;
  const email = normalizeEmail(String(raw.Email ?? raw.Recipient ?? m?.toEmail ?? ''));
  const type = String(raw.Type ?? '');
  const hard = HARD_BOUNCE_TYPES.has(type) || Number(raw.TypeCode) === 1;
  const info = `${type}: ${String(raw.Description ?? '').slice(0, 300)}`.slice(0, 500);

  if (m) {
    await db.emailMessage.update({
      where: { id: m.id },
      data: {
        ...(spam
          ? { status: 'SPAM_COMPLAINT' as const }
          : hard
            ? { status: 'BOUNCED' as const }
            : {}),
        bounceType: type.slice(0, 60) || null,
        bounceInfo: info,
        postmarkMessageId: m.postmarkMessageId ?? p.MessageID ?? null,
      },
    });
  }
  if (email && (spam || hard)) {
    await addSuppression(db, email, spam ? 'SPAM_COMPLAINT' : 'HARD_BOUNCE');
    await note(
      db,
      m?.prospectId ?? null,
      spam ? 'Spamklacht ontvangen; adres geblokkeerd' : 'Harde bounce; adres geblokkeerd',
    );
    if (spam) await blockProspect(db, m?.prospectId ?? null, 'Spamklacht');
  }
}

async function onOpen(db: Db, p: z.infer<typeof base>, raw: Record<string, unknown>, now: Date) {
  const m = await findMessage(db, p);
  if (m && !m.openedAt) {
    await db.emailMessage.update({
      where: { id: m.id },
      data: { openedAt: raw.ReceivedAt ? new Date(String(raw.ReceivedAt)) : now },
    });
  }
}

async function onSubscriptionChange(db: Db, raw: Record<string, unknown>) {
  if (raw.SuppressSending !== true) return;
  const email = normalizeEmail(String(raw.Recipient ?? ''));
  if (!email) return;
  const why = String(raw.SuppressionReason ?? '');
  await addSuppression(
    db,
    email,
    why === 'HardBounce' ? 'HARD_BOUNCE' : why === 'SpamComplaint' ? 'SPAM_COMPLAINT' : 'OPT_OUT',
  );
}

const inboundSchema = z
  .object({
    MessageID: z.string(),
    FromFull: z.object({ Email: z.string() }).loose(),
    Subject: z.string().optional(),
    TextBody: z.string().optional(),
    StrippedTextReply: z.string().optional(),
    MailboxHash: z.string().max(60).optional(),
    Headers: z.array(z.object({ Name: z.string(), Value: z.string() })).optional(),
  })
  .loose();

async function onInbound(db: Db, raw: Record<string, unknown>, now: Date) {
  const inb = inboundSchema.safeParse(raw);
  if (!inb.success) return;
  const d = inb.data;
  const from = normalizeEmail(d.FromFull.Email);
  const text = (d.StrippedTextReply?.trim() || d.TextBody?.trim() || '').slice(0, 2000);

  // Koppeling: het plus-adres (MailboxHash = onze EmailMessage-id) is een onraadbaar token dat wijzelf
  // uitgeven en dus BETROUWBAAR. De From-header van een inkomende mail is niet geauthenticeerd door Postmark
  // voordat de webhook wordt aangeroepen, dus een match op alleen het afzenderadres (fallback) is SPOOFBAAR:
  // iedereen kan een mail "van" een bestaand contactadres sturen. Zulke fallback-matches mogen daarom nooit
  // automatisch tot suppressie of een "niet geïnteresseerd"-status leiden; wel tot een gewone (te controleren)
  // reactie-registratie, zodat een medewerker het beoordeelt.
  const trustedMsg = d.MailboxHash
    ? await db.emailMessage.findUnique({ where: { id: d.MailboxHash } })
    : null;
  const fallbackMsg =
    trustedMsg ??
    (await db.emailMessage.findFirst({
      where: { toEmail: from, status: { not: 'FAILED' } },
      orderBy: { createdAt: 'desc' },
    }));
  let prospectId = fallbackMsg?.prospectId ?? null;
  prospectId ??=
    (
      await db.prospect.findFirst({
        where: { contactEmail: from, anonymizedAt: null },
        select: { id: true },
      })
    )?.id ?? null;
  if (!prospectId) return; // niet te koppelen: het event is wel vastgelegd (zonder inhoud)
  const trusted = !!trustedMsg;

  const isAuto =
    d.Headers?.some(
      (h) =>
        /^(auto-submitted|x-autoreply|x-autorespond)$/i.test(h.Name) &&
        !/^no$/i.test(h.Value.trim()),
    ) || AUTO_REPLY_SUBJECT_RE.test(d.Subject ?? '');
  if (isAuto) {
    await note(db, prospectId, 'Automatisch antwoord ontvangen (bijv. afwezigheidsmelding)');
    return;
  }

  const optOutRequested = OPT_OUT_RE.test(text);
  const optOut = optOutRequested && trusted;
  if (optOut) await addSuppression(db, from, 'OPT_OUT');

  const p = await db.prospect.findUnique({
    where: { id: prospectId },
    select: { status: true, ownerId: true },
  });
  if (!p) return;
  const target: ProspectStatus = optOut ? 'REPLY_NOT_INTERESTED' : 'REPLY_RECEIVED';
  const move = canTransition(p.status, target);
  await db.prospect.update({
    where: { id: prospectId },
    data: {
      ...(move ? { status: target } : {}),
      nextActionAt: now,
      ...(optOut ? { notInterestedReason: 'Afmelding per antwoord' } : {}),
    },
  });
  const unverifiedNote =
    optOutRequested && !trusted
      ? ' (afmeldverzoek gedetecteerd maar niet automatisch verwerkt: koppeling aan deze prospect kon niet worden geverifieerd — handmatig controleren)'
      : '';
  await db.prospectActivity.create({
    data: {
      prospectId,
      type: 'REPLY_RECEIVED',
      description: (text || '(leeg antwoord)') + unverifiedNote,
      oldValue: move ? p.status : null,
      newValue: move ? target : null,
      metadata: {
        emailMessageId: fallbackMsg?.id ?? null,
        inboundMessageId: d.MessageID,
        optOut,
        trusted,
      },
    },
  });
  if (!optOut) {
    await db.task.create({
      data: {
        prospectId,
        type: 'REVIEW',
        assigneeId: p.ownerId,
        dueAt: new Date(now.getTime() + 24 * 3600 * 1000),
        priority: 'HIGH',
        description: unverifiedNote
          ? 'Mogelijk afmeldverzoek beoordelen (koppeling onzeker)'
          : 'Reactie op e-mail beoordelen',
      },
    });
  }
  await audit(db, {
    action: 'outreach.reply.inbound',
    entityType: 'Prospect',
    entityId: prospectId,
    metadata: { optOut, trusted },
  });
}

export type WebhookOutcome = 'processed' | 'duplicate' | 'ignored';

/**
 * Verwerkt één Postmark-event idempotent en atomair. Een named lock per event (`spark:webhook:<key>`)
 * serialiseert gelijktijdige aanleveringen van hetzelfde event (Postmark-hertries, load balancers): zonder
 * lock konden twee parallelle aanroepen allebei de business-logica uitvoeren vóór een van beide het event als
 * verwerkt markeerde. Aanmaak + verwerking + markering lopen in dezelfde transactie, zodat een fout halverwege
 * alles terugdraait — een volgende hertry (door Postmark, na de 5xx die de route dan teruggeeft) verwerkt het
 * event dan volledig opnieuw in plaats van dubbele activiteiten/taken achter te laten.
 */
export async function processPostmarkEvent(
  db: PrismaClient,
  payload: unknown,
  now = new Date(),
): Promise<WebhookOutcome> {
  const parsed = base.safeParse(payload);
  if (!parsed.success) return 'ignored';
  const raw = payload as Record<string, unknown>;
  const k = externalKeyOf(raw);
  if (!k) return 'ignored';
  const lockName = `spark:webhook:${k.key}`.slice(0, 64);

  try {
    return await db.$transaction(
      (tx) =>
        withNamedLock(tx, lockName, async (): Promise<WebhookOutcome> => {
          let event = await tx.webhookEvent.findUnique({ where: { externalKey: k.key } });
          if (event?.processedAt) return 'duplicate';
          event ??= await tx.webhookEvent.create({
            data: {
              provider: 'postmark',
              externalKey: k.key,
              eventType: k.type,
              payload: storable(raw) as object,
            },
          });
          switch (k.type) {
            case 'Delivery':
              await onDelivery(tx, parsed.data, raw, now);
              break;
            case 'Bounce':
              await onBounce(tx, parsed.data, raw, false);
              break;
            case 'SpamComplaint':
              await onBounce(tx, parsed.data, raw, true);
              break;
            case 'Open':
            case 'Click':
              await onOpen(tx, parsed.data, raw, now);
              break;
            case 'SubscriptionChange':
              await onSubscriptionChange(tx, raw);
              break;
            case 'Inbound':
              await onInbound(tx, raw, now);
              break;
          }
          await tx.webhookEvent.update({
            where: { id: event.id },
            data: { processedAt: now, error: null },
          });
          return 'processed';
        }),
      { timeout: 30_000 },
    );
  } catch (err) {
    // De transactie is teruggedraaid (geen halve schrijfacties blijven staan). Alleen de foutmelding vastleggen
    // voor zichtbaarheid, buiten de transactie om: dit schrijft geen bedrijfsdata en mag dus niet-atomair.
    const msg = (err instanceof Error ? err.name : 'fout').slice(0, 200);
    await db.webhookEvent
      .upsert({
        where: { externalKey: k.key },
        create: {
          provider: 'postmark',
          externalKey: k.key,
          eventType: k.type,
          payload: storable(raw) as object,
          error: msg,
        },
        update: { error: msg },
      })
      .catch(() => undefined);
    throw err;
  }
}
