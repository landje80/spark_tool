import type { OutreachDraft, PrismaClient, Prospect } from '@prisma/client';
import type { Env } from '../../config/env.js';
import { MailError, type MailPort } from '../../integrations/postmark/types.js';
import { AppError } from '../../shared/errors/app-error.js';
import { logger } from '../../shared/logging/logger.js';
import type { Actor } from '../../shared/security/actor.js';
import { startOfDay } from '../../shared/time.js';
import { audit } from '../audit/audit.js';
import { canTransition } from '../prospects/status.js';
import { CLOSED_STATUSES } from '../prospects/service.js';
import { assertHeaderSafe, cleanText, paragraphsOf, renderHtml, renderText } from './render.js';
import { getOutreachSettings } from './settings.js';
import { addSuppression, isSuppressed, normalizeEmail } from './suppression.js';
import { contentHashOf, signConfirm, unsubscribeToken, verifyConfirm } from './tokens.js';
import type { DraftWriter } from './writer.js';

export interface OutreachDeps {
  db: PrismaClient;
  mail: MailPort;
  writer: DraftWriter;
  env: Env;
  now?: () => Date;
}

const CONFIRM_TTL_MS = 10 * 60 * 1000;
const EMAIL_RE = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;

export const mailConfigured = (env: Env): boolean =>
  !!env.POSTMARK_SERVER_TOKEN && !!env.POSTMARK_FROM_EMAIL;

const clock = (d: OutreachDeps) => (d.now ?? (() => new Date()))();

function validRecipient(raw: string | null | undefined): string {
  const to = normalizeEmail(assertHeaderSafe(raw ?? '', 'to'));
  if (!to || to.length > 320 || !EMAIL_RE.test(to)) {
    throw new AppError('VALIDATION_ERROR', 'Ongeldige invoer', [
      { path: 'to', message: 'Vul een geldig zakelijk e-mailadres in' },
    ]);
  }
  return to;
}

export function unsubscribeUrl(env: Env, emailMessageId: string): string {
  return `${env.APP_BASE_URL}${env.APP_BASE_PATH}/unsubscribe/${unsubscribeToken(env.SESSION_SECRET, emailMessageId)}`;
}

function footerParagraphs(footer: string, unsubUrl: string): string[] {
  return [footer, `Liever geen e-mail meer van ons? Meld u hier af: ${unsubUrl}`];
}

async function loadDraft(db: PrismaClient, id: string) {
  const draft = await db.outreachDraft.findUnique({
    where: { id },
    include: { prospect: true },
  });
  if (!draft || draft.prospect.anonymizedAt)
    throw new AppError('NOT_FOUND', 'Concept niet gevonden');
  return draft;
}

export async function createDraft(deps: OutreachDeps, actor: Actor, prospectId: string) {
  const { db, writer, env } = deps;
  const prospect = await db.prospect.findUnique({ where: { id: prospectId } });
  if (!prospect || prospect.anonymizedAt) throw new AppError('NOT_FOUND', 'Prospect niet gevonden');
  if (CLOSED_STATUSES.includes(prospect.status)) {
    throw new AppError('CONFLICT', 'Deze prospect wordt niet meer benaderd');
  }
  const out = await writer.write({
    companyName: prospect.companyName,
    city: prospect.city,
    industry: prospect.industry,
    outreachAngle: prospect.outreachAngle,
    senderName: env.POSTMARK_FROM_NAME,
  });
  const subject =
    cleanText(out.subject).replace(/\s+/g, ' ').slice(0, 200) || 'Kennismaking met Spark';
  const paragraphs = out.paragraphs.map(cleanText).filter(Boolean);

  return db.$transaction(async (tx) => {
    const draft = await tx.outreachDraft.create({
      data: {
        prospectId,
        subject,
        openingLine: out.openingLine.slice(0, 500),
        textBody: paragraphs.join('\n\n'),
        htmlBody: renderHtml(paragraphs),
        generatedBy: writer.name.slice(0, 100),
      },
    });
    if (
      canTransition(prospect.status, 'OUTREACH_PREPARED') &&
      ['NEW', 'IN_REVIEW'].includes(prospect.status)
    ) {
      await tx.prospect.update({
        where: { id: prospectId },
        data: { status: 'OUTREACH_PREPARED' },
      });
      await tx.prospectActivity.create({
        data: {
          prospectId,
          type: 'STATUS_CHANGED',
          actorId: actor.id,
          oldValue: prospect.status,
          newValue: 'OUTREACH_PREPARED',
          description: 'Conceptmail voorbereid',
        },
      });
    }
    await audit(tx, {
      actorId: actor.id,
      action: 'outreach.draft.create',
      entityType: 'OutreachDraft',
      entityId: draft.id,
      ip: actor.ip,
      metadata: { writer: writer.name },
    });
    return draft;
  });
}

export async function updateDraft(
  db: PrismaClient,
  actor: Actor,
  id: string,
  input: { subject: string; textBody: string },
) {
  const draft = await loadDraft(db, id);
  if (draft.status !== 'DRAFT')
    throw new AppError('CONFLICT', 'Dit concept kan niet meer worden gewijzigd');
  const subject = assertHeaderSafe(input.subject, 'subject').replace(/\s+/g, ' ').slice(0, 200);
  const paragraphs = paragraphsOf(input.textBody);
  if (!subject || paragraphs.length === 0) {
    throw new AppError('VALIDATION_ERROR', 'Ongeldige invoer', [
      { path: 'textBody', message: 'Onderwerp en tekst zijn verplicht' },
    ]);
  }
  const updated = await db.outreachDraft.update({
    where: { id },
    data: { subject, textBody: paragraphs.join('\n\n'), htmlBody: renderHtml(paragraphs) },
  });
  await audit(db, {
    actorId: actor.id,
    action: 'outreach.draft.update',
    entityType: 'OutreachDraft',
    entityId: id,
    ip: actor.ip,
  });
  return updated;
}

export async function discardDraft(db: PrismaClient, actor: Actor, id: string) {
  const draft = await loadDraft(db, id);
  if (draft.status !== 'DRAFT')
    throw new AppError('CONFLICT', 'Dit concept kan niet meer worden verwijderd');
  await db.outreachDraft.update({ where: { id }, data: { status: 'DISCARDED' } });
  await audit(db, {
    actorId: actor.id,
    action: 'outreach.draft.discard',
    entityType: 'OutreachDraft',
    entityId: id,
    ip: actor.ip,
  });
}

/** Alle controles die vóór verzending gelden; gedeeld door preview en definitieve verzending. */
async function assertCanSend(
  deps: OutreachDeps,
  draft: OutreachDraft,
  prospect: Prospect,
  to: string,
): Promise<{ warnings: string[] }> {
  const { db, env } = deps;
  if (!mailConfigured(env)) {
    throw new AppError('CONFLICT', 'E-mail is niet geconfigureerd', { reason: 'not_configured' });
  }
  if (draft.status !== 'DRAFT') throw new AppError('CONFLICT', 'Dit concept is al verwerkt');
  if (CLOSED_STATUSES.includes(prospect.status)) {
    throw new AppError('CONFLICT', 'Deze prospect wordt niet meer benaderd', {
      reason: 'prospect_closed',
    });
  }
  if (await isSuppressed(db, to)) {
    throw new AppError('SUPPRESSED', 'Naar dit adres mag niet worden gemaild', {
      reason: 'suppressed',
    });
  }
  const settings = await getOutreachSettings(db);
  const today = await db.emailMessage.count({
    where: {
      createdAt: { gte: startOfDay(clock(deps), env.LEAD_GENERATION_TIMEZONE) },
      status: { not: 'FAILED' },
    },
  });
  if (today >= settings.dailyLimit) {
    throw new AppError('RATE_LIMITED', 'Het dagelijkse verzendlimiet is bereikt', {
      reason: 'daily_limit',
    });
  }
  const warnings: string[] = [];
  if (!prospect.contactEmail) warnings.push('no_contact_email');
  else if (normalizeEmail(prospect.contactEmail) !== to) warnings.push('recipient_differs');
  const earlier = await db.emailMessage.count({
    where: { prospectId: prospect.id, toEmail: to, status: { not: 'FAILED' } },
  });
  if (earlier > 0) warnings.push('already_emailed');
  return { warnings };
}

/** Stap 1 van verzenden: valideert alles en toont de definitieve mail; levert een bevestigingstoken op. */
export async function prepareSend(
  deps: OutreachDeps,
  actor: Actor,
  draftId: string,
  toInput: string | null | undefined,
) {
  const draft = await loadDraft(deps.db, draftId);
  const to = validRecipient(toInput ?? draft.prospect.contactEmail);
  const { warnings } = await assertCanSend(deps, draft, draft.prospect, to);
  const settings = await getOutreachSettings(deps.db);
  const exp = clock(deps).getTime() + CONFIRM_TTL_MS;
  const confirmToken = signConfirm(deps.env.SESSION_SECRET, {
    draftId,
    to,
    contentHash: contentHashOf(draft.subject, draft.textBody),
    exp,
  });
  await audit(deps.db, {
    actorId: actor.id,
    action: 'outreach.prepare_send',
    entityType: 'OutreachDraft',
    entityId: draftId,
    ip: actor.ip,
  });
  return {
    from: { email: deps.env.POSTMARK_FROM_EMAIL ?? '', name: deps.env.POSTMARK_FROM_NAME },
    to,
    subject: draft.subject,
    paragraphs: paragraphsOf(draft.textBody),
    footer: footerParagraphs(settings.footer, '[persoonlijke afmeldlink]'),
    warnings,
    confirmToken,
    expiresAt: new Date(exp),
  };
}

export interface SendInput {
  to: string;
  confirmToken: string;
  followUpDays?: number | null;
}

/**
 * Stap 2: verzendt na expliciete bevestiging. Idempotent (sleutel = concept + ontvanger + inhoud): een
 * dubbelklik of parallelle aanroep verstuurt nooit twee keer. Postmark wordt buiten de databasetransactie
 * aangeroepen; het resultaat wordt daarna in één transactie vastgelegd.
 */
export async function sendDraft(
  deps: OutreachDeps,
  actor: Actor,
  draftId: string,
  input: SendInput,
) {
  const { db, mail, env } = deps;
  const now = clock(deps);
  const draft = await loadDraft(db, draftId);
  const to = validRecipient(input.to);

  const confirm = verifyConfirm(env.SESSION_SECRET, input.confirmToken, now.getTime());
  if (!confirm || confirm.draftId !== draftId || confirm.to !== to) {
    throw new AppError(
      'CONFLICT',
      'Bevestiging is ongeldig of verlopen; bekijk het voorbeeld opnieuw',
      { reason: 'confirm_invalid' },
    );
  }
  const contentHash = contentHashOf(draft.subject, draft.textBody);
  if (confirm.contentHash !== contentHash) {
    throw new AppError(
      'CONFLICT',
      'Het concept is gewijzigd na het voorbeeld; bekijk het opnieuw',
      { reason: 'content_changed' },
    );
  }

  const key = contentHashOf(`${draftId}|${to}`, contentHash);
  const existing = await db.emailMessage.findUnique({ where: { idempotencyKey: key } });
  if (existing && existing.status !== 'FAILED') {
    // Al verzonden of bezig: idempotent antwoord, geen tweede mail.
    return { emailMessageId: existing.id, status: existing.status, duplicate: true as const };
  }

  await assertCanSend(deps, draft, draft.prospect, to);
  const settings = await getOutreachSettings(db);

  // Claim: unieke sleutel voorkomt dat twee gelijktijdige verzoeken beide versturen.
  let msg;
  try {
    if (existing) {
      // Herhaalpoging na een mislukte verzending: alleen de eerste van twee gelijktijdige verzoeken mag claimen.
      const claimed = await db.emailMessage.updateMany({
        where: { id: existing.id, status: 'FAILED' },
        data: { status: 'QUEUED', bounceInfo: null },
      });
      if (claimed.count !== 1) {
        const other = await db.emailMessage.findUniqueOrThrow({ where: { id: existing.id } });
        return { emailMessageId: other.id, status: other.status, duplicate: true as const };
      }
      msg = existing;
    } else {
      msg = await db.emailMessage.create({
        data: {
          prospectId: draft.prospectId,
          draftId,
          idempotencyKey: key,
          fromEmail: env.POSTMARK_FROM_EMAIL!,
          toEmail: to,
          subject: draft.subject,
          status: 'QUEUED',
          metadata: { actorId: actor.id },
        },
      });
    }
  } catch (err) {
    if ((err as { code?: string }).code === 'P2002') {
      const other = await db.emailMessage.findUniqueOrThrow({ where: { idempotencyKey: key } });
      return { emailMessageId: other.id, status: other.status, duplicate: true as const };
    }
    throw err;
  }

  const unsubUrl = unsubscribeUrl(env, msg.id);
  const paragraphs = paragraphsOf(draft.textBody);
  const footer = footerParagraphs(settings.footer, unsubUrl);
  const replyTo = env.POSTMARK_INBOUND_DOMAIN
    ? `reply+${msg.id}@${env.POSTMARK_INBOUND_DOMAIN}`
    : undefined;

  let sent;
  try {
    sent = await mail.send({
      fromEmail: env.POSTMARK_FROM_EMAIL!,
      fromName: env.POSTMARK_FROM_NAME,
      to,
      subject: draft.subject,
      textBody: renderText(paragraphs, footer),
      htmlBody: renderHtml(paragraphs, footer),
      replyTo,
      messageStream: env.POSTMARK_MESSAGE_STREAM,
      tag: 'outreach',
      trackOpens: settings.trackOpens,
      metadata: { emailMessageId: msg.id },
      headers: [
        { name: 'List-Unsubscribe', value: `<${unsubUrl}>` },
        { name: 'List-Unsubscribe-Post', value: 'List-Unsubscribe=One-Click' },
      ],
    });
  } catch (err) {
    const kind = err instanceof MailError ? err.kind : 'unknown';
    await db.emailMessage.update({
      where: { id: msg.id },
      data: {
        status: 'FAILED',
        bounceInfo: `Verzenden mislukt (${kind})`.slice(0, 200),
        metadata: {
          actorId: actor.id,
          errorKind: kind,
          errorCode: err instanceof MailError ? (err.code ?? null) : null,
        },
      },
    });
    await audit(db, {
      actorId: actor.id,
      action: 'outreach.send_failed',
      entityType: 'EmailMessage',
      entityId: msg.id,
      ip: actor.ip,
      metadata: { kind },
    });
    if (kind === 'inactive_recipient') {
      await addSuppression(db, to, 'HARD_BOUNCE');
      throw new AppError('SUPPRESSED', 'Naar dit adres mag niet worden gemaild', {
        reason: 'inactive_recipient',
      });
    }
    if (kind === 'rate_limited')
      throw new AppError('RATE_LIMITED', 'De mailprovider vraagt om even te wachten');
    throw new AppError('UPSTREAM_ERROR', 'De mailprovider gaf een fout', { reason: kind });
  }

  // Bookkeeping met een paar pogingen: de mail is verzonden, dus dit mag niet stilletjes verloren gaan.
  let bookkeeping = true;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await finalizeSent(
        deps,
        actor,
        msg.id,
        draft,
        draft.prospect,
        sent,
        input.followUpDays ?? null,
      );
      bookkeeping = true;
      break;
    } catch (err) {
      bookkeeping = false;
      logger.error(
        { emailMessageId: msg.id, attempt, err: err instanceof Error ? err.name : 'unknown' },
        'Verzonden, maar registratie mislukt',
      );
    }
  }
  return {
    emailMessageId: msg.id,
    status: bookkeeping ? ('SENT' as const) : ('QUEUED' as const),
    duplicate: false as const,
    postmarkMessageId: sent.messageId,
    bookkeeping,
  };
}

async function finalizeSent(
  deps: OutreachDeps,
  actor: Actor,
  emailMessageId: string,
  draft: OutreachDraft,
  prospect: Prospect,
  sent: { messageId: string; submittedAt: Date },
  followUpDays: number | null,
): Promise<void> {
  const now = clock(deps);
  await deps.db.$transaction(async (tx) => {
    // Guard: alleen de EERSTE geslaagde poging voert de rest uit. Zonder deze guard zou een herhaalde
    // aanroep van de bovenliggende retrylus (bv. na een client-timeout terwijl de vorige poging al was
    // gecommit) een tweede EMAIL_SENT-activiteit, opvolgtaak en auditregel aanmaken.
    const claim = await tx.emailMessage.updateMany({
      where: { id: emailMessageId, status: { not: 'SENT' } },
      data: { status: 'SENT', postmarkMessageId: sent.messageId, sentAt: sent.submittedAt },
    });
    if (claim.count !== 1) return;
    await tx.outreachDraft.update({
      where: { id: draft.id },
      data: { status: 'SENT', approvedById: actor.id, approvedAt: now },
    });
    const fresh = await tx.prospect.findUniqueOrThrow({
      where: { id: prospect.id },
      select: { status: true },
    });
    const toEmailed = canTransition(fresh.status, 'EMAILED');
    const followUpAt = followUpDays ? new Date(now.getTime() + followUpDays * 86_400_000) : null;
    await tx.prospect.update({
      where: { id: prospect.id },
      data: {
        ...(toEmailed ? { status: 'EMAILED' as const } : {}),
        ...(followUpAt ? { nextActionAt: followUpAt } : {}),
      },
    });
    await tx.prospectActivity.create({
      data: {
        prospectId: prospect.id,
        type: 'EMAIL_SENT',
        actorId: actor.id,
        description: `E-mail verzonden: ${draft.subject}`.slice(0, 500),
        oldValue: toEmailed ? fresh.status : null,
        newValue: toEmailed ? 'EMAILED' : null,
        metadata: { emailMessageId },
      },
    });
    if (followUpAt) {
      await tx.task.create({
        data: {
          prospectId: prospect.id,
          type: 'FOLLOW_UP',
          assigneeId: actor.id,
          dueAt: followUpAt,
          description: 'Opvolgen na e-mail',
        },
      });
      await tx.prospectActivity.create({
        data: {
          prospectId: prospect.id,
          type: 'TASK_CREATED',
          actorId: actor.id,
          description: 'Opvolgtaak na e-mail aangemaakt',
        },
      });
    }
    await audit(tx, {
      actorId: actor.id,
      action: 'outreach.send',
      entityType: 'EmailMessage',
      entityId: emailMessageId,
      ip: actor.ip,
    });
  });
}

/** Handmatig een antwoord registreren (telefonisch of via een ander kanaal binnengekomen). */
export async function registerReply(
  db: PrismaClient,
  actor: Actor,
  prospectId: string,
  input: { text: string; notInterested: boolean },
) {
  return db.$transaction(async (tx) => {
    const p = await tx.prospect.findUnique({
      where: { id: prospectId },
      select: { status: true, anonymizedAt: true },
    });
    if (!p || p.anonymizedAt) throw new AppError('NOT_FOUND', 'Prospect niet gevonden');
    const to = input.notInterested ? 'REPLY_NOT_INTERESTED' : 'REPLY_RECEIVED';
    if (!canTransition(p.status, to) && p.status !== to) {
      throw new AppError('INVALID_TRANSITION', `Overgang ${p.status} → ${to} is niet toegestaan`);
    }
    await tx.prospect.update({
      where: { id: prospectId },
      data: {
        status: to,
        ...(input.notInterested ? { notInterestedReason: input.text.slice(0, 2000) } : {}),
      },
    });
    await tx.prospectActivity.create({
      data: {
        prospectId,
        type: 'REPLY_RECEIVED',
        actorId: actor.id,
        description: input.text.slice(0, 2000),
        oldValue: p.status,
        newValue: to,
      },
    });
    await audit(tx, {
      actorId: actor.id,
      action: 'outreach.reply.manual',
      entityType: 'Prospect',
      entityId: prospectId,
      ip: actor.ip,
    });
    return { status: to };
  });
}
