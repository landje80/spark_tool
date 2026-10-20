import { describe, expect, it } from 'vitest';
import {
  AiDraftWriter,
  DRAFT_SYSTEM_PROMPT,
  FOLLOW_UP_SYSTEM_PROMPT,
  TemplateDraftWriter,
  type DraftInput,
  type StructuredClient,
} from './writer.js';

const base: DraftInput = {
  companyName: 'Café De Zwaan',
  city: 'Zwolle',
  industry: 'horeca',
  outreachAngle: 'Mooie terrasfoto’s',
  senderName: 'Spark Team',
};
const previous = [
  {
    subject: 'Kennismaking: Café De Zwaan en Spark',
    text: 'Goedendag, EERSTE-MAIL-TEKST. Met vriendelijke groet, Spark Team',
    sentAt: new Date('2026-10-01T08:00:00Z'),
  },
];

function fakeClient() {
  const calls: { system: string; user: string }[] = [];
  const client = {
    async generate(p: { system: string; user: string }) {
      calls.push({ system: p.system, user: p.user });
      return { subject: 'Onderwerp', openingLine: 'Hallo', paragraphs: ['Goedendag,', 'Tekst.'] };
    },
  } as unknown as StructuredClient;
  return { client, calls };
}

describe('AiDraftWriter', () => {
  it('gebruikt voor een eerste mail de kennismakingsprompt zonder eerdere mails', async () => {
    const { client, calls } = fakeClient();
    await new AiDraftWriter(client, 'claude-sonnet-5').write(base);
    expect(calls[0]!.system).toBe(DRAFT_SYSTEM_PROMPT);
    expect(calls[0]!.user).not.toContain('Eerdere mail');
  });

  it('gebruikt voor een opvolging de opvolgprompt en geeft de eerdere mails als context mee', async () => {
    const { client, calls } = fakeClient();
    await new AiDraftWriter(client, 'claude-sonnet-5').write({ ...base, previous });
    expect(calls[0]!.system).toBe(FOLLOW_UP_SYSTEM_PROMPT);
    expect(calls[0]!.user).toContain('Eerdere mail 1 (verzonden 2026-10-01)');
    expect(calls[0]!.user).toContain('Onderwerp: Kennismaking: Café De Zwaan en Spark');
    expect(calls[0]!.user).toContain('EERSTE-MAIL-TEKST');
  });

  it('beperkt de context tot drie eerdere mails van elk maximaal 1500 tekens', async () => {
    const { client, calls } = fakeClient();
    const long = Array.from({ length: 5 }, (_, i) => ({
      subject: `Mail ${i + 1}`,
      text: `START${i + 1}-` + 'x'.repeat(5000),
      sentAt: null,
    }));
    await new AiDraftWriter(client, 'claude-sonnet-5').write({ ...base, previous: long });
    const user = calls[0]!.user;
    expect(user).toContain('Eerdere mail 3');
    expect(user).not.toContain('Eerdere mail 4');
    expect(user.length).toBeLessThan(6500);
  });

  it('verbiedt een "Re:"-onderwerp en een verwijt in de opvolgprompt', () => {
    expect(FOLLOW_UP_SYSTEM_PROMPT).toContain("NIET met 'Re:'");
    expect(FOLLOW_UP_SYSTEM_PROMPT).toContain('geen verwijt');
  });
});

describe('TemplateDraftWriter (opvolging)', () => {
  it('schrijft een opvolging zonder verzonnen feiten en zonder dubbele voorvoegsels', async () => {
    const out = await new TemplateDraftWriter().write({
      ...base,
      previous: [{ ...previous[0]!, subject: 'Opvolging: Kennismaking' }],
    });
    expect(out.subject).toBe('Opvolging: Kennismaking');
    expect(out.paragraphs.join(' ')).toContain('Café De Zwaan');
    expect(out.paragraphs.at(-1)).toContain('Spark Team');
  });
});
