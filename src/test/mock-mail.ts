import { randomBytes } from 'node:crypto';
import type {
  MailError,
  MailPort,
  OutgoingMail,
  SentMail,
} from '../integrations/postmark/types.js';

/** Vervangt Postmark in tests: legt verzonden mails vast, kan fouten en vertraging simuleren. */
export class MockMail implements MailPort {
  sent: OutgoingMail[] = [];
  failWith: MailError | null = null;
  delayMs = 0;

  async send(mail: OutgoingMail): Promise<SentMail> {
    if (this.delayMs) await new Promise((r) => setTimeout(r, this.delayMs));
    if (this.failWith) throw this.failWith;
    this.sent.push(mail);
    return { messageId: `pm-${randomBytes(6).toString('hex')}`, submittedAt: new Date() };
  }

  reset(): void {
    this.sent = [];
    this.failWith = null;
    this.delayMs = 0;
  }
}

export const POSTMARK_TEST_ENV = {
  POSTMARK_SERVER_TOKEN: 'pm-token-niet-echt',
  POSTMARK_FROM_EMAIL: 'spark@nicenext.test',
  POSTMARK_FROM_NAME: 'Spark Team',
  POSTMARK_WEBHOOK_SECRET: 'whsec-test-geheim-minimaal-32-tekens-lang',
  POSTMARK_INBOUND_DOMAIN: 'inbound.example.test',
};

export const basicAuth = (user: string, pass: string): string =>
  `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;
