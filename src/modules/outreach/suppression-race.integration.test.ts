import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '../../shared/database/client.js';
import { resetDb } from '../../test/helpers.js';
import { addSuppression, emailHash } from './suppression.js';
import { processPostmarkEvent } from './webhooks.js';

const db = getDb();

beforeEach(async () => {
  await resetDb(db);
});
afterAll(async () => {
  await db.$disconnect();
});

describe('gelijktijdige suppressie van hetzelfde adres', () => {
  it('addSuppression is atomair: parallelle aanroepen geven geen fout en één rij', async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 12 }, () => addSuppression(db, 'Race@Example.com', 'HARD_BOUNCE')),
    );
    expect(results.filter((r) => r.status === 'rejected')).toEqual([]);
    expect(await db.emailSuppression.count()).toBe(1);
    expect(
      await db.emailSuppression.count({ where: { emailHash: emailHash('race@example.com') } }),
    ).toBe(1);
  });

  it('behoudt de eerste reden als er later een tweede komt', async () => {
    await addSuppression(db, 'a@example.com', 'SPAM_COMPLAINT');
    await addSuppression(db, 'a@example.com', 'HARD_BOUNCE');
    const row = await db.emailSuppression.findFirstOrThrow();
    expect(row.reason).toBe('SPAM_COMPLAINT');
  });

  it('Bounce- en Spam-event tegelijk (zoals Postmark bij het opslaan van een webhook) slagen beide', async () => {
    // Regressie: dit gaf 500 (unique-fout op EmailSuppression.emailHash) en dus "Not Verified" in Postmark.
    for (let i = 0; i < 25; i++) {
      await db.emailSuppression.deleteMany();
      await db.webhookEvent.deleteMany();
      const bounce = {
        RecordType: 'Bounce',
        ID: 1000 + i,
        Type: 'HardBounce',
        TypeCode: 1,
        Email: 'john@example.com',
        MessageID: '00000000-0000-0000-0000-000000000000',
        BouncedAt: '2026-10-05T10:00:00Z',
      };
      const spam = {
        ...bounce,
        RecordType: 'SpamComplaint',
        ID: 2000 + i,
        Type: 'SpamNotification',
      };
      const results = await Promise.allSettled([
        processPostmarkEvent(db, bounce),
        processPostmarkEvent(db, spam),
      ]);
      expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled']);
    }
  });
});
