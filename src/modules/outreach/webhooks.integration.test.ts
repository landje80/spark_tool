import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../server/app.js';
import { getDb } from '../../shared/database/client.js';
import { TEST_SECRET, resetDb, testEnv } from '../../test/helpers.js';
import { MockMail, POSTMARK_TEST_ENV, basicAuth } from '../../test/mock-mail.js';
import { isSuppressed } from './suppression.js';
import { unsubscribeToken } from './tokens.js';
import { processPostmarkEvent } from './webhooks.js';

const db = getDb();
const mail = new MockMail();
const app = createApp(testEnv(POSTMARK_TEST_ENV), { mail });
const noSecret = createApp(testEnv({ ...POSTMARK_TEST_ENV, POSTMARK_WEBHOOK_SECRET: '' }), {
  mail,
});
const HOOK = '/tool/webhooks/postmark';
const AUTH = basicAuth('postmark', POSTMARK_TEST_ENV.POSTMARK_WEBHOOK_SECRET);

const hook = (payload: object, auth: string | null = AUTH, target = app) => {
  const r = request(target).post(HOOK);
  if (auth) r.set('Authorization', auth);
  return r.send(payload);
};

const inbound = (over: Record<string, unknown> = {}) => ({
  MessageID: 'in-1',
  FromFull: { Email: 'Info@CafeDeZwaan.nl', Name: 'Café' },
  Subject: 'Re: Kennismaking',
  TextBody: 'Ja graag!\n\nOp 21 sep schreef Spark:\n> heel lang geciteerd bericht',
  StrippedTextReply: 'Ja graag, bel me maar.',
  ...over,
});

async function setup(status: 'EMAILED' | 'NEW' = 'EMAILED') {
  const prospect = await db.prospect.create({
    data: {
      companyName: 'Café De Zwaan',
      normalizedName: 'cafe de zwaan',
      domain: 'cafedezwaan.nl',
      contactEmail: 'info@cafedezwaan.nl',
      status,
    },
  });
  const msg = await db.emailMessage.create({
    data: {
      prospectId: prospect.id,
      idempotencyKey: `k-${prospect.id}`,
      postmarkMessageId: 'pm-msg-1',
      fromEmail: 'spark@nicenext.test',
      toEmail: 'info@cafedezwaan.nl',
      subject: 'Kennismaking',
      status: 'SENT',
      sentAt: new Date(),
    },
  });
  return { prospect, msg };
}

beforeEach(async () => {
  await resetDb(db);
});
afterAll(async () => {
  await db.$disconnect();
});

describe('webhookauthenticatie (Basic Auth; Postmark heeft geen HMAC)', () => {
  const payload = {
    RecordType: 'Delivery',
    MessageID: 'pm-msg-1',
    DeliveredAt: '2026-09-21T09:00:00Z',
  };

  it('weigert verzoeken zonder of met verkeerde inloggegevens', async () => {
    const none = await hook(payload, null);
    expect(none.status).toBe(401);
    expect(none.headers['www-authenticate']).toContain('Basic');
    expect((await hook(payload, basicAuth('postmark', 'fout'))).status).toBe(401);
    expect(
      (await hook(payload, basicAuth('iemand', POSTMARK_TEST_ENV.POSTMARK_WEBHOOK_SECRET))).status,
    ).toBe(401);
    expect((await hook(payload, 'Bearer abc')).status).toBe(401);
    expect(await db.webhookEvent.count()).toBe(0);
  });

  it('weigert alles (503) als er geen webhook-geheim is ingesteld', async () => {
    expect((await hook(payload, AUTH, noSecret)).status).toBe(503);
  });

  it('accepteert correcte inloggegevens', async () => {
    await setup();
    expect((await hook(payload)).status).toBe(200);
  });

  it('negeert onbekende recordtypes zonder ze op te slaan', async () => {
    const res = await hook({ RecordType: 'Iets', MessageID: 'x' });
    expect(res.status).toBe(200);
    expect(res.body.outcome).toBe('ignored');
    expect(await db.webhookEvent.count()).toBe(0);
  });
});

describe('afleverstatus', () => {
  it('verwerkt delivery en is idempotent bij herhaalde aanlevering', async () => {
    const { msg } = await setup();
    const p = {
      RecordType: 'Delivery',
      MessageID: 'pm-msg-1',
      DeliveredAt: '2026-09-21T09:00:00Z',
    };
    expect((await hook(p)).body.outcome).toBe('processed');
    expect((await hook(p)).body.outcome).toBe('duplicate');
    expect(await db.webhookEvent.count()).toBe(1);
    const m = await db.emailMessage.findUniqueOrThrow({ where: { id: msg.id } });
    expect(m.status).toBe('DELIVERED');
    expect(m.deliveredAt?.toISOString()).toBe('2026-09-21T09:00:00.000Z');
  });

  it('zet een harde bounce op BOUNCED, suppresseert het adres en blokkeert nieuwe verzending', async () => {
    const { msg, prospect } = await setup();
    await hook({
      RecordType: 'Bounce',
      ID: 692560173,
      Type: 'HardBounce',
      TypeCode: 1,
      MessageID: 'pm-msg-1',
      Email: 'Info@CafeDeZwaan.nl',
      Description: 'The server was unable to deliver',
      BouncedAt: '2026-09-21T09:05:00Z',
    });
    expect(await db.emailMessage.findUniqueOrThrow({ where: { id: msg.id } })).toMatchObject({
      status: 'BOUNCED',
      bounceType: 'HardBounce',
    });
    expect(await isSuppressed(db, 'info@cafedezwaan.nl')).toBe(true);
    expect(
      await db.prospectActivity.count({
        where: { prospectId: prospect.id, description: { contains: 'Harde bounce' } },
      }),
    ).toBe(1);
  });

  it('suppresseert een zachte bounce niet', async () => {
    const { msg } = await setup();
    await hook({
      RecordType: 'Bounce',
      ID: 1,
      Type: 'SoftBounce',
      TypeCode: 4096,
      MessageID: 'pm-msg-1',
      Email: 'info@cafedezwaan.nl',
      Description: 'mailbox vol',
    });
    expect(await isSuppressed(db, 'info@cafedezwaan.nl')).toBe(false);
    expect(await db.emailMessage.findUniqueOrThrow({ where: { id: msg.id } })).toMatchObject({
      status: 'SENT',
      bounceType: 'SoftBounce',
    });
  });

  it('verwerkt een spamklacht: status, suppressie en prospect niet meer benaderen', async () => {
    const { msg, prospect } = await setup();
    await hook({
      RecordType: 'SpamComplaint',
      ID: 7,
      Type: 'SpamComplaint',
      MessageID: 'pm-msg-1',
      Email: 'info@cafedezwaan.nl',
    });
    expect((await db.emailMessage.findUniqueOrThrow({ where: { id: msg.id } })).status).toBe(
      'SPAM_COMPLAINT',
    );
    expect(await isSuppressed(db, 'info@cafedezwaan.nl')).toBe(true);
    expect(await db.prospect.findUniqueOrThrow({ where: { id: prospect.id } })).toMatchObject({
      status: 'NOT_INTERESTED',
      notInterestedReason: 'Spamklacht',
    });
  });

  it('registreert de eerste opening en overschrijft die niet', async () => {
    const { msg } = await setup();
    await hook({ RecordType: 'Open', MessageID: 'pm-msg-1', ReceivedAt: '2026-09-21T10:00:00Z' });
    await hook({
      RecordType: 'Click',
      MessageID: 'pm-msg-1',
      ReceivedAt: '2026-09-21T11:00:00Z',
      OriginalLink: 'https://spark.nicenext.nl',
    });
    expect(
      (await db.emailMessage.findUniqueOrThrow({ where: { id: msg.id } })).openedAt?.toISOString(),
    ).toBe('2026-09-21T10:00:00.000Z');
  });

  it('neemt een suppressie van Postmark zelf over (SubscriptionChange)', async () => {
    await setup();
    await hook({
      RecordType: 'SubscriptionChange',
      MessageID: 'pm-msg-1',
      Recipient: 'iemand@example.com',
      SuppressSending: true,
      SuppressionReason: 'ManualSuppression',
      ChangedAt: '2026-09-21T09:00:00Z',
    });
    expect(await isSuppressed(db, 'iemand@example.com')).toBe(true);
  });

  it('herstelt de koppeling via onze metadata als de registratie na verzending mislukte', async () => {
    const { msg } = await setup();
    await db.emailMessage.update({
      where: { id: msg.id },
      data: { postmarkMessageId: null, status: 'QUEUED', sentAt: null },
    });
    await hook({
      RecordType: 'Delivery',
      MessageID: 'pm-nieuw',
      DeliveredAt: '2026-09-21T09:00:00Z',
      Metadata: { emailMessageId: msg.id },
    });
    expect(await db.emailMessage.findUniqueOrThrow({ where: { id: msg.id } })).toMatchObject({
      status: 'DELIVERED',
      postmarkMessageId: 'pm-nieuw',
    });
  });

  it('draait de hele verwerking terug bij een echte fout, zodat een hertry alles in één keer afwerkt', async () => {
    // Forceer een échte fout diep in de transactie (FK-schending op Task.assigneeId) — sinds verwerking
    // atomair in één transactie loopt (named lock + tx), moet de fout uit de echte database komen; een
    // gemockte/"kapotte" Prisma-laag raakt de interne tx niet meer (die is intern aan $transaction).
    const { msg, prospect } = await setup();
    await db.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS = 0');
    await db.prospect.update({ where: { id: prospect.id }, data: { ownerId: 'bestaat-niet' } });
    await db.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS = 1');

    const payload = inbound({ MailboxHash: msg.id });
    await expect(processPostmarkEvent(db, payload)).rejects.toThrow();
    const event = await db.webhookEvent.findFirstOrThrow();
    expect(event.processedAt).toBeNull();
    expect(event.error).toBeTruthy();
    // Teruggedraaid: geen halve activiteit/taak blijft staan.
    expect(
      await db.prospectActivity.count({
        where: { prospectId: prospect.id, type: 'REPLY_RECEIVED' },
      }),
    ).toBe(0);
    expect(await db.task.count({ where: { prospectId: prospect.id } })).toBe(0);

    await db.prospect.update({ where: { id: prospect.id }, data: { ownerId: null } });
    expect(await processPostmarkEvent(db, payload)).toBe('processed'); // Postmark probeert opnieuw
    expect(
      await db.prospectActivity.count({
        where: { prospectId: prospect.id, type: 'REPLY_RECEIVED' },
      }),
    ).toBe(1);
    expect(await db.task.count({ where: { prospectId: prospect.id } })).toBe(1);
    expect((await db.webhookEvent.findFirstOrThrow()).processedAt).not.toBeNull();
    expect(await db.webhookEvent.count()).toBe(1);
  });

  it('verwerkt gelijktijdige aanlevering van hetzelfde event maar één keer (geen dubbele activiteit)', async () => {
    const { msg, prospect } = await setup();
    const payload = inbound({ MailboxHash: msg.id });
    const results = await Promise.all([hook(payload), hook(payload)]);
    expect(results.map((r) => r.body.outcome).sort()).toEqual(['duplicate', 'processed']);
    expect(await db.webhookEvent.count()).toBe(1);
    expect(
      await db.prospectActivity.count({
        where: { prospectId: prospect.id, type: 'REPLY_RECEIVED' },
      }),
    ).toBe(1);
    expect(await db.task.count({ where: { prospectId: prospect.id } })).toBe(1);
  });

  it('een spamklacht is definitief: een latere (soft)bounce overschrijft het detail niet', async () => {
    const { msg } = await setup();
    await hook({
      RecordType: 'SpamComplaint',
      ID: 1,
      Type: 'SpamComplaint',
      MessageID: 'pm-msg-1',
      Email: 'info@cafedezwaan.nl',
    });
    await hook({
      RecordType: 'Bounce',
      ID: 2,
      Type: 'SoftBounce',
      TypeCode: 4096,
      MessageID: 'pm-msg-1',
      Email: 'info@cafedezwaan.nl',
      Description: 'mailbox vol',
    });
    expect(await db.emailMessage.findUniqueOrThrow({ where: { id: msg.id } })).toMatchObject({
      status: 'SPAM_COMPLAINT',
      bounceType: 'SpamComplaint',
    });
  });
});

describe('inkomende antwoorden', () => {
  it('koppelt via het plus-adres, zet reactie ontvangen, maakt een taak en bewaart alleen het antwoord', async () => {
    const { msg, prospect } = await setup();
    const res = await hook(inbound({ MailboxHash: msg.id, TextBody: 'GEVOELIGE-VOLLEDIGE-BODY' }));
    expect(res.body.outcome).toBe('processed');
    const p = await db.prospect.findUniqueOrThrow({ where: { id: prospect.id } });
    expect(p.status).toBe('REPLY_RECEIVED');
    expect(p.nextActionAt).not.toBeNull();
    const act = await db.prospectActivity.findFirstOrThrow({
      where: { prospectId: prospect.id, type: 'REPLY_RECEIVED' },
    });
    expect(act.description).toBe('Ja graag, bel me maar.');
    expect(act.metadata).toMatchObject({ emailMessageId: msg.id, optOut: false });
    expect(
      await db.task.count({ where: { prospectId: prospect.id, type: 'REVIEW', priority: 'HIGH' } }),
    ).toBe(1);
    // Volledige mailbody en bijlagen worden niet in het webhookarchief bewaard.
    expect(JSON.stringify((await db.webhookEvent.findFirstOrThrow()).payload)).not.toContain(
      'GEVOELIGE',
    );
  });

  it('is idempotent: dezelfde inkomende mail twee keer geeft één antwoord en één taak', async () => {
    const { msg, prospect } = await setup();
    await hook(inbound({ MailboxHash: msg.id }));
    expect((await hook(inbound({ MailboxHash: msg.id }))).body.outcome).toBe('duplicate');
    expect(
      await db.prospectActivity.count({
        where: { prospectId: prospect.id, type: 'REPLY_RECEIVED' },
      }),
    ).toBe(1);
    expect(await db.task.count({ where: { prospectId: prospect.id } })).toBe(1);
  });

  it('koppelt zonder plus-adres via het afzenderadres', async () => {
    const { prospect } = await setup();
    await hook(inbound());
    expect((await db.prospect.findUniqueOrThrow({ where: { id: prospect.id } })).status).toBe(
      'REPLY_RECEIVED',
    );
  });

  it('behandelt een afmelding per antwoord als opt-out zodra betrouwbaar gekoppeld (plus-adres): suppressie, geen taak', async () => {
    const { prospect, msg } = await setup();
    await hook(
      inbound({ MailboxHash: msg.id, StrippedTextReply: 'Graag afmelden voor jullie mails.' }),
    );
    expect(await isSuppressed(db, 'info@cafedezwaan.nl')).toBe(true);
    expect(await db.prospect.findUniqueOrThrow({ where: { id: prospect.id } })).toMatchObject({
      status: 'REPLY_NOT_INTERESTED',
      notInterestedReason: 'Afmelding per antwoord',
    });
    expect(await db.task.count()).toBe(0);
  });

  it('verwerkt een afmeldverzoek NIET automatisch als de koppeling alleen via het (spoofbare) afzenderadres loopt', async () => {
    // From-headers zijn niet geauthenticeerd door Postmark; zonder MailboxHash (ons eigen onraadbare token)
    // mag een "afmelden"-tekst dus nooit automatisch tot suppressie of een statuswijziging leiden — anders kan
    // iedereen die een bestaand contactadres kent, dat bedrijf permanent laten blokkeren voor outreach.
    const { prospect } = await setup();
    await hook(inbound({ StrippedTextReply: 'Graag afmelden voor jullie mails.' }));
    expect(await isSuppressed(db, 'info@cafedezwaan.nl')).toBe(false);
    const p = await db.prospect.findUniqueOrThrow({ where: { id: prospect.id } });
    expect(p.status).toBe('REPLY_RECEIVED');
    expect(p.notInterestedReason).toBeNull();
    const act = await db.prospectActivity.findFirstOrThrow({
      where: { prospectId: prospect.id, type: 'REPLY_RECEIVED' },
    });
    expect(act.description).toContain('niet automatisch verwerkt');
    expect(act.metadata).toMatchObject({ optOut: false, trusted: false });
    const task = await db.task.findFirstOrThrow({ where: { prospectId: prospect.id } });
    expect(task.description).toContain('Mogelijk afmeldverzoek');
  });

  it('laat een automatisch antwoord de status ongemoeid', async () => {
    const { prospect } = await setup();
    await hook(
      inbound({
        Subject: 'Automatisch antwoord: afwezig',
        Headers: [{ Name: 'Auto-Submitted', Value: 'auto-replied' }],
      }),
    );
    expect((await db.prospect.findUniqueOrThrow({ where: { id: prospect.id } })).status).toBe(
      'EMAILED',
    );
    expect(
      await db.prospectActivity.count({
        where: { prospectId: prospect.id, description: { contains: 'Automatisch antwoord' } },
      }),
    ).toBe(1);
    expect(await db.task.count()).toBe(0);
  });

  it('legt een niet te koppelen antwoord vast zonder iets te wijzigen', async () => {
    const { prospect } = await setup();
    const res = await hook(
      inbound({ MessageID: 'in-onbekend', FromFull: { Email: 'vreemde@example.org' } }),
    );
    expect(res.status).toBe(200);
    expect(await db.webhookEvent.count()).toBe(1);
    expect((await db.prospect.findUniqueOrThrow({ where: { id: prospect.id } })).status).toBe(
      'EMAILED',
    );
    expect(await db.prospectActivity.count({ where: { type: 'REPLY_RECEIVED' } })).toBe(0);
  });
});

describe('afmeldpagina', () => {
  it('toont een gemaskeerd adres en verwerkt afmelden: suppressie + prospect niet meer benaderen', async () => {
    const { msg, prospect } = await setup();
    const token = unsubscribeToken(TEST_SECRET, msg.id);
    const page = await request(app).get(`/tool/unsubscribe/${token}`);
    expect(page.status).toBe(200);
    expect(page.headers['content-type']).toContain('text/html');
    expect(page.headers['cache-control']).toBe('no-store');
    expect(page.headers['content-security-policy']).toContain("default-src 'self'");
    expect(page.text).toContain('i***@cafedezwaan.nl');
    expect(page.text).not.toContain('info@cafedezwaan.nl');

    const done = await request(app).post(`/tool/unsubscribe/${token}`).type('form').send('');
    expect(done.status).toBe(200);
    expect(done.text).toContain('afgemeld');
    expect(await isSuppressed(db, 'info@cafedezwaan.nl')).toBe(true);
    expect(await db.prospect.findUniqueOrThrow({ where: { id: prospect.id } })).toMatchObject({
      status: 'NOT_INTERESTED',
      notInterestedReason: 'Afgemeld via afmeldlink',
    });
  });

  it('is idempotent en werkt voor one-click (List-Unsubscribe-Post)', async () => {
    const { msg, prospect } = await setup();
    const token = unsubscribeToken(TEST_SECRET, msg.id);
    const one = await request(app)
      .post(`/tool/unsubscribe/${token}`)
      .type('form')
      .send('List-Unsubscribe=One-Click');
    expect(one.status).toBe(200);
    expect(
      (
        await request(app)
          .post(`/tool/unsubscribe/${token}`)
          .type('form')
          .send('List-Unsubscribe=One-Click')
      ).status,
    ).toBe(200);
    expect(
      await db.prospectActivity.count({
        where: { prospectId: prospect.id, description: 'Afgemeld via afmeldlink' },
      }),
    ).toBe(1);
    expect(await db.emailSuppression.count()).toBe(1);
  });

  it('weigert vervalste of onbekende tokens zonder informatie te lekken', async () => {
    const { msg } = await setup();
    const good = unsubscribeToken(TEST_SECRET, msg.id);
    for (const t of [
      `${good}x`,
      `${msg.id}.onzin`,
      'onzin',
      unsubscribeToken(TEST_SECRET, 'bestaat-niet'),
      unsubscribeToken('ander-geheim', msg.id),
    ]) {
      const r = await request(app).get(`/tool/unsubscribe/${t}`);
      expect(r.status).toBe(404);
      expect((await request(app).post(`/tool/unsubscribe/${t}`).type('form').send('')).status).toBe(
        404,
      );
    }
    expect(await db.emailSuppression.count()).toBe(0);
  });
});
