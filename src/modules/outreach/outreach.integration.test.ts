import type { Role, User } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { MailError } from '../../integrations/postmark/types.js';
import { createApp } from '../../server/app.js';
import { getDb } from '../../shared/database/client.js';
import { TEST_SECRET, login, makeUser, resetDb, testEnv } from '../../test/helpers.js';
import { MockMail, POSTMARK_TEST_ENV } from '../../test/mock-mail.js';
import { isSuppressed } from './suppression.js';
import { signConfirm, contentHashOf } from './tokens.js';

const db = getDb();
const mail = new MockMail();
const app = createApp(testEnv(POSTMARK_TEST_ENV), { mail });
const unconfigured = createApp(testEnv(), { mail });
const API = '/tool/api';

async function as(role: Role, target = app) {
  const user: User = await makeUser(db, role);
  const { cookie, csrf } = await login(db, user);
  return {
    user,
    get: (url: string) => request(target).get(`${API}${url}`).set('Cookie', cookie),
    post: (url: string, body: object = {}) =>
      request(target)
        .post(`${API}${url}`)
        .set('Cookie', cookie)
        .set('x-csrf-token', csrf)
        .send(body),
    patch: (url: string, body: object = {}) =>
      request(target)
        .patch(`${API}${url}`)
        .set('Cookie', cookie)
        .set('x-csrf-token', csrf)
        .send(body),
    postNoCsrf: (url: string, body: object = {}) =>
      request(target).post(`${API}${url}`).set('Cookie', cookie).send(body),
  };
}
type Client = Awaited<ReturnType<typeof as>>;

const newProspect = (over: Record<string, unknown> = {}) =>
  db.prospect.create({
    data: {
      companyName: 'Café De Zwaan',
      normalizedName: 'cafe de zwaan',
      city: 'Zwolle',
      domain: 'cafedezwaan.nl',
      contactEmail: 'info@cafedezwaan.nl',
      outreachAngle: 'Mooie terrasfoto’s op Instagram.',
      ...over,
    },
  });

/** Maakt een concept en doorloopt de preview; geeft alles terug wat voor verzenden nodig is. */
async function draftAndPrepare(c: Client, prospectId: string, to?: string) {
  const d = await c.post(`/prospects/${prospectId}/drafts`);
  expect(d.status).toBe(201);
  const prep = await c.post(`/outreach/drafts/${d.body.id}/prepare-send`, to ? { to } : {});
  return { draftId: d.body.id as string, prep };
}

let sales: Client;
beforeEach(async () => {
  await resetDb(db);
  mail.reset();
  sales = await as('SALES');
});
afterAll(async () => {
  await db.$disconnect();
});

describe('concepten', () => {
  it('maakt een concept uit het sjabloon en zet de prospect op "Outreach voorbereid"', async () => {
    const p = await newProspect();
    const res = await sales.post(`/prospects/${p.id}/drafts`);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ status: 'DRAFT', generatedBy: 'template' });
    expect(res.body.textBody).toContain('terrasfoto');
    expect(res.body.subject).toContain('Café De Zwaan');
    expect((await db.prospect.findUniqueOrThrow({ where: { id: p.id } })).status).toBe(
      'OUTREACH_PREPARED',
    );
    expect(
      await db.prospectActivity.count({
        where: { prospectId: p.id, newValue: 'OUTREACH_PREPARED' },
      }),
    ).toBe(1);
  });

  it('vereist outreach.prepare en weigert prospects die niet meer benaderd worden', async () => {
    const p = await newProspect();
    expect((await (await as('VIEWER')).post(`/prospects/${p.id}/drafts`)).status).toBe(403);
    expect((await (await as('CONTENT_EDITOR')).post(`/prospects/${p.id}/drafts`)).status).toBe(403);
    const closed = await newProspect({
      companyName: 'Dicht',
      normalizedName: 'dicht',
      domain: 'dicht.nl',
      status: 'NOT_INTERESTED',
    });
    expect((await sales.post(`/prospects/${closed.id}/drafts`)).status).toBe(409);
  });

  it('escapet HTML volledig: ruwe HTML van een gebruiker komt nooit in de mail', async () => {
    const p = await newProspect();
    const d = (await sales.post(`/prospects/${p.id}/drafts`)).body;
    const evil =
      'Hallo <script>alert(1)</script> en <img src=x onerror=alert(2)> & "quotes"\n\nTweede alinea met <b>vet</b> genoeg tekst.';
    const res = await sales.patch(`/outreach/drafts/${d.id}`, {
      subject: 'Onderwerp <b>x</b>',
      textBody: evil,
    });
    expect(res.status).toBe(200);
    expect(res.body.htmlBody).not.toContain('<script');
    expect(res.body.htmlBody).not.toContain('<img');
    expect(res.body.htmlBody).not.toContain('<b>');
    expect(res.body.htmlBody).toContain('&lt;script&gt;');
    expect(res.body.htmlBody).toContain('&amp;');
    expect(res.body.htmlBody).toContain('<p');
  });

  it('weigert header-injectie in het onderwerp', async () => {
    const p = await newProspect();
    const d = (await sales.post(`/prospects/${p.id}/drafts`)).body;
    const body = { textBody: 'Voldoende lange tekst voor het concept, echt waar.' };
    for (const subject of ['Hallo\r\nBcc: evil@example.com', 'Hallo\nX-Header: 1']) {
      expect((await sales.patch(`/outreach/drafts/${d.id}`, { ...body, subject })).status).toBe(
        400,
      );
    }
    expect(
      (await db.outreachDraft.findUniqueOrThrow({ where: { id: d.id } })).subject,
    ).not.toContain('Bcc');
  });

  it('staat wijzigen en verwijderen alleen toe zolang het een concept is', async () => {
    const p = await newProspect();
    const d = (await sales.post(`/prospects/${p.id}/drafts`)).body;
    expect((await sales.post(`/outreach/drafts/${d.id}/discard`)).status).toBe(204);
    expect(
      (await sales.patch(`/outreach/drafts/${d.id}`, { subject: 'x', textBody: 'a'.repeat(30) }))
        .status,
    ).toBe(409);
  });
});

describe('verzenden na expliciete bevestiging', () => {
  it('toont eerst een preview met afzender, footer en waarschuwingen', async () => {
    const p = await newProspect();
    const { prep } = await draftAndPrepare(sales, p.id, 'ander@cafedezwaan.nl');
    expect(prep.status).toBe(200);
    expect(prep.body.from).toEqual({ email: 'spark@nicenext.test', name: 'Spark Team' });
    expect(prep.body.to).toBe('ander@cafedezwaan.nl');
    expect(prep.body.footer.join(' ')).toContain('Meld u hier af');
    expect(prep.body.warnings).toContain('recipient_differs');
    expect(prep.body.confirmToken).toBeTruthy();
    expect(mail.sent).toHaveLength(0); // preview verstuurt niets
  });

  it('verstuurt precies één mail met footer, afmeldlink, reply-to en metadata, en legt alles vast', async () => {
    const p = await newProspect();
    const { draftId, prep } = await draftAndPrepare(sales, p.id);
    const res = await sales.post(`/outreach/drafts/${draftId}/send`, {
      to: prep.body.to,
      confirmToken: prep.body.confirmToken,
      followUpDays: 3,
    });
    expect(res.status).toBe(201);

    expect(mail.sent).toHaveLength(1);
    const m = mail.sent[0]!;
    const msg = await db.emailMessage.findFirstOrThrow();
    expect(m).toMatchObject({
      to: 'info@cafedezwaan.nl',
      fromEmail: 'spark@nicenext.test',
      tag: 'outreach',
      trackOpens: false,
      messageStream: 'outbound',
    });
    expect(m.textBody).toContain('Meld u hier af: http://localhost:3000/tool/unsubscribe/');
    expect(m.htmlBody).toContain('/tool/unsubscribe/');
    expect(m.replyTo).toBe(`reply+${msg.id}@inbound.example.test`);
    expect(m.metadata).toEqual({ emailMessageId: msg.id });
    expect(m.headers.map((h) => h.name)).toEqual(['List-Unsubscribe', 'List-Unsubscribe-Post']);
    expect(m.headers[1]!.value).toBe('List-Unsubscribe=One-Click');

    expect(msg).toMatchObject({
      status: 'SENT',
      toEmail: 'info@cafedezwaan.nl',
      prospectId: p.id,
      draftId,
    });
    expect(msg.postmarkMessageId).toMatch(/^pm-/);
    expect(await db.outreachDraft.findUniqueOrThrow({ where: { id: draftId } })).toMatchObject({
      status: 'SENT',
      approvedById: sales.user.id,
    });
    const prospect = await db.prospect.findUniqueOrThrow({ where: { id: p.id } });
    expect(prospect.status).toBe('EMAILED');
    expect(prospect.nextActionAt).not.toBeNull();
    expect(
      await db.prospectActivity.count({ where: { prospectId: p.id, type: 'EMAIL_SENT' } }),
    ).toBe(1);
    expect(
      await db.task.count({
        where: { prospectId: p.id, type: 'FOLLOW_UP', assigneeId: sales.user.id },
      }),
    ).toBe(1);
    expect(await db.auditLog.count({ where: { action: 'outreach.send' } })).toBe(1);
  });

  it('gebruikt de door de beheerder ingestelde afzenderidentificatie als footer', async () => {
    const admin = await as('ADMIN');
    expect(
      (
        await admin.post('/admin/outreach', {
          dailyLimit: 50,
          trackOpens: true,
          footer: 'Spark BV · Zwolle · KvK 12345678',
        })
      ).status,
    ).toBe(200);
    const p = await newProspect();
    const { draftId, prep } = await draftAndPrepare(sales, p.id);
    await sales.post(`/outreach/drafts/${draftId}/send`, {
      to: prep.body.to,
      confirmToken: prep.body.confirmToken,
    });
    expect(mail.sent[0]!.textBody).toContain('KvK 12345678');
    expect(mail.sent[0]!.trackOpens).toBe(true);
  });

  it('weigert verzenden zonder geldig bevestigingstoken', async () => {
    const p = await newProspect();
    const { draftId, prep } = await draftAndPrepare(sales, p.id);
    const bad = await sales.post(`/outreach/drafts/${draftId}/send`, {
      to: prep.body.to,
      confirmToken: 'x'.repeat(40),
    });
    expect(bad.status).toBe(409);
    expect(bad.body.details.reason).toBe('confirm_invalid');
    const other = await sales.post(`/outreach/drafts/${draftId}/send`, {
      to: 'iemand-anders@example.com',
      confirmToken: prep.body.confirmToken,
    });
    expect(other.body.details.reason).toBe('confirm_invalid'); // token geldt alleen voor de bevestigde ontvanger
    expect(
      (
        await sales.postNoCsrf(`/outreach/drafts/${draftId}/send`, {
          to: prep.body.to,
          confirmToken: prep.body.confirmToken,
        })
      ).status,
    ).toBe(403);
    expect(mail.sent).toHaveLength(0);
  });

  it('weigert verzenden als het concept na de preview is gewijzigd', async () => {
    const p = await newProspect();
    const { draftId, prep } = await draftAndPrepare(sales, p.id);
    await sales.patch(`/outreach/drafts/${draftId}`, {
      subject: 'Ineens anders',
      textBody: 'Een compleet andere tekst dan getoond werd.',
    });
    const res = await sales.post(`/outreach/drafts/${draftId}/send`, {
      to: prep.body.to,
      confirmToken: prep.body.confirmToken,
    });
    expect(res.status).toBe(409);
    expect(res.body.details.reason).toBe('content_changed');
    expect(mail.sent).toHaveLength(0);
  });

  it('weigert een verlopen bevestiging', async () => {
    const p = await newProspect();
    const d = (await sales.post(`/prospects/${p.id}/drafts`)).body;
    const expired = signConfirm(TEST_SECRET, {
      draftId: d.id,
      to: 'info@cafedezwaan.nl',
      contentHash: contentHashOf(d.subject, d.textBody),
      exp: Date.now() - 1000,
    });
    const res = await sales.post(`/outreach/drafts/${d.id}/send`, {
      to: 'info@cafedezwaan.nl',
      confirmToken: expired,
    });
    expect(res.status).toBe(409);
    expect(mail.sent).toHaveLength(0);
  });

  it('is idempotent: dubbelklik en parallelle verzoeken versturen één keer', async () => {
    const p = await newProspect();
    const { draftId, prep } = await draftAndPrepare(sales, p.id);
    const body = { to: prep.body.to, confirmToken: prep.body.confirmToken };
    mail.delayMs = 50;
    const results = await Promise.all(
      [1, 2, 3].map(() => sales.post(`/outreach/drafts/${draftId}/send`, body)),
    );
    expect(mail.sent).toHaveLength(1);
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.every((r) => [200, 201].includes(r.status))).toBe(true);
    expect(await db.emailMessage.count()).toBe(1);
    // Nogmaals achteraf: nog steeds geen tweede mail.
    const again = await sales.post(`/outreach/drafts/${draftId}/send`, body);
    expect(again.status).toBe(200);
    expect(again.body.duplicate).toBe(true);
    expect(mail.sent).toHaveLength(1);
    // Ook de bijbehorende registratie (finalizeSent) is niet dubbel uitgevoerd.
    expect(
      await db.prospectActivity.count({ where: { prospectId: p.id, type: 'EMAIL_SENT' } }),
    ).toBe(1);
    expect(await db.auditLog.count({ where: { action: 'outreach.send' } })).toBe(1);
  });

  it('legt een mislukte verzending vast en staat één veilige herhaling toe', async () => {
    const p = await newProspect();
    const { draftId, prep } = await draftAndPrepare(sales, p.id);
    const body = { to: prep.body.to, confirmToken: prep.body.confirmToken };
    mail.failWith = new MailError('boem', 'unknown', 300);
    const fail = await sales.post(`/outreach/drafts/${draftId}/send`, body);
    expect(fail.status).toBe(502);
    expect(await db.emailMessage.findFirstOrThrow()).toMatchObject({ status: 'FAILED' });
    expect((await db.outreachDraft.findUniqueOrThrow({ where: { id: draftId } })).status).toBe(
      'DRAFT',
    );
    expect((await db.prospect.findUniqueOrThrow({ where: { id: p.id } })).status).toBe(
      'OUTREACH_PREPARED',
    );

    mail.failWith = null;
    mail.delayMs = 40;
    const retries = await Promise.all(
      [1, 2].map(() => sales.post(`/outreach/drafts/${draftId}/send`, body)),
    );
    expect(mail.sent).toHaveLength(1); // twee gelijktijdige herhalingen: één mail
    expect(retries.filter((r) => r.status === 201)).toHaveLength(1);
    expect(await db.emailMessage.count()).toBe(1);
    expect((await db.emailMessage.findFirstOrThrow()).status).toBe('SENT');
  });

  it('blokkeert en suppresseert een adres dat de provider als gedeactiveerd meldt', async () => {
    const p = await newProspect();
    const { draftId, prep } = await draftAndPrepare(sales, p.id);
    mail.failWith = new MailError('inactief', 'inactive_recipient', 406);
    const res = await sales.post(`/outreach/drafts/${draftId}/send`, {
      to: prep.body.to,
      confirmToken: prep.body.confirmToken,
    });
    expect(res.status).toBe(409);
    expect(await isSuppressed(db, 'info@cafedezwaan.nl')).toBe(true);
  });

  it('zonder configuratie is er geen verzending mogelijk (duidelijke melding)', async () => {
    const p = await newProspect();
    const c = await as('SALES', unconfigured);
    const d = (await c.post(`/prospects/${p.id}/drafts`)).body;
    const res = await c.post(`/outreach/drafts/${d.id}/prepare-send`, {});
    expect(res.status).toBe(409);
    expect(res.body.details).toEqual({ reason: 'not_configured' });
  });

  it('gebruikt in de testomgeving nooit een echte mailprovider (standaardpoort weigert)', async () => {
    const noInjection = createApp(testEnv(POSTMARK_TEST_ENV)); // geen mock geïnjecteerd
    const p = await newProspect();
    const c = await as('SALES', noInjection);
    const { draftId, prep } = await (async () => {
      const d = (await c.post(`/prospects/${p.id}/drafts`)).body;
      return {
        draftId: d.id as string,
        prep: await c.post(`/outreach/drafts/${d.id}/prepare-send`, {}),
      };
    })();
    const res = await c.post(`/outreach/drafts/${draftId}/send`, {
      to: prep.body.to,
      confirmToken: prep.body.confirmToken,
    });
    expect(res.status).toBe(502);
    expect(mail.sent).toHaveLength(0);
  });
});

describe('suppressie, blokkades en limieten', () => {
  it('weigert een handmatig geblokkeerd adres en bewaart alleen een hash', async () => {
    const p = await newProspect();
    expect(
      (await sales.post('/outreach/suppressions', { email: 'Info@CafeDeZwaan.nl' })).status,
    ).toBe(201);
    const d = (await sales.post(`/prospects/${p.id}/drafts`)).body;
    const res = await sales.post(`/outreach/drafts/${d.id}/prepare-send`, {});
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('SUPPRESSED');
    const rows = await db.$queryRawUnsafe<Record<string, unknown>[]>(
      'SELECT * FROM EmailSuppression',
    );
    expect(JSON.stringify(rows)).not.toContain('cafedezwaan.nl/');
    expect(JSON.stringify(rows.map((r) => r.emailHash))).not.toContain('@');
  });

  it('verstuurt niet naar prospects met een gesloten status', async () => {
    const p = await newProspect();
    const d = (await sales.post(`/prospects/${p.id}/drafts`)).body;
    await db.prospect.update({ where: { id: p.id }, data: { status: 'NOT_INTERESTED' } });
    expect((await sales.post(`/outreach/drafts/${d.id}/prepare-send`, {})).status).toBe(409);
  });

  it('handhaaft het dagelijkse verzendlimiet', async () => {
    const admin = await as('ADMIN');
    await admin.post('/admin/outreach', { dailyLimit: 1, trackOpens: false, footer: 'Spark' });
    const a = await newProspect();
    const b = await newProspect({
      companyName: 'Tweede',
      normalizedName: 'tweede',
      domain: 'tweede.nl',
      contactEmail: 'info@tweede.nl',
    });
    const one = await draftAndPrepare(sales, a.id);
    await sales.post(`/outreach/drafts/${one.draftId}/send`, {
      to: one.prep.body.to,
      confirmToken: one.prep.body.confirmToken,
    });
    const d2 = (await sales.post(`/prospects/${b.id}/drafts`)).body;
    const res = await sales.post(`/outreach/drafts/${d2.id}/prepare-send`, {});
    expect(res.status).toBe(429);
    expect(mail.sent).toHaveLength(1);
  });

  it('valideert de ontvanger (geen ongeldig adres, geen header-injectie)', async () => {
    const p = await newProspect();
    const d = (await sales.post(`/prospects/${p.id}/drafts`)).body;
    for (const to of ['geen-adres', 'a@b', 'x@example.com\r\nBcc: evil@example.com']) {
      expect((await sales.post(`/outreach/drafts/${d.id}/prepare-send`, { to })).status).toBe(400);
    }
  });

  it('vereist outreach.send voor preview en verzenden', async () => {
    const p = await newProspect();
    const d = (await sales.post(`/prospects/${p.id}/drafts`)).body;
    const editor = await as('CONTENT_EDITOR');
    expect((await editor.post(`/outreach/drafts/${d.id}/prepare-send`, {})).status).toBe(403);
    expect(
      (
        await (
          await as('VIEWER')
        ).post(`/outreach/drafts/${d.id}/send`, { to: 'a@b.nl', confirmToken: 'x'.repeat(20) })
      ).status,
    ).toBe(403);
  });
});

describe('antwoorden handmatig registreren', () => {
  it('zet de status op reactie ontvangen of reactie - geen interesse en logt het', async () => {
    const p = await newProspect({ status: 'EMAILED' });
    const res = await sales.post(`/prospects/${p.id}/replies`, {
      text: 'Bel me volgende week terug.',
    });
    expect(res.status).toBe(201);
    expect((await db.prospect.findUniqueOrThrow({ where: { id: p.id } })).status).toBe(
      'REPLY_RECEIVED',
    );
    const q = await newProspect({
      companyName: 'Andere',
      normalizedName: 'andere',
      domain: 'andere.nl',
      status: 'EMAILED',
    });
    await sales.post(`/prospects/${q.id}/replies`, {
      text: 'Geen interesse, dank.',
      notInterested: true,
    });
    expect(await db.prospect.findUniqueOrThrow({ where: { id: q.id } })).toMatchObject({
      status: 'REPLY_NOT_INTERESTED',
      notInterestedReason: 'Geen interesse, dank.',
    });
  });

  it('weigert een ongeldige statusovergang en een leeg antwoord', async () => {
    const p = await newProspect(); // NEW -> REPLY_RECEIVED is niet toegestaan
    expect((await sales.post(`/prospects/${p.id}/replies`, { text: 'hoi' })).status).toBe(409);
    expect((await sales.post(`/prospects/${p.id}/replies`, { text: '' })).status).toBe(400);
  });
});

describe('instellingen', () => {
  it('zijn alleen voor beheerders zichtbaar en worden gevalideerd', async () => {
    expect((await (await as('MANAGER')).get('/admin/outreach')).status).toBe(403);
    const admin = await as('ADMIN');
    const res = await admin.get('/admin/outreach');
    expect(res.body).toMatchObject({
      configured: true,
      settings: { dailyLimit: 50, trackOpens: false },
    });
    expect(JSON.stringify(res.body)).not.toContain('pm-token');
    expect(
      (await admin.post('/admin/outreach', { dailyLimit: 0, trackOpens: false, footer: 'x' }))
        .status,
    ).toBe(400);
  });
});
