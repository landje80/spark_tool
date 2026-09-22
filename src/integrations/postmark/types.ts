export interface OutgoingMail {
  fromEmail: string;
  fromName: string;
  to: string;
  subject: string;
  textBody: string;
  htmlBody: string;
  replyTo?: string;
  messageStream: string;
  tag: string;
  trackOpens: boolean;
  /** Komt terug in Postmark-webhooks; koppelt events aan onze EmailMessage. */
  metadata: Record<string, string>;
  headers: { name: string; value: string }[];
}

export interface SentMail {
  messageId: string;
  submittedAt: Date;
}

export type MailErrorKind =
  'inactive_recipient' | 'rate_limited' | 'invalid_input' | 'auth' | 'network' | 'unknown';

/** Fout van de mailprovider, ontdaan van alles wat geheim of persoonlijk kan zijn. */
export class MailError extends Error {
  constructor(
    message: string,
    readonly kind: MailErrorKind,
    readonly code?: number,
  ) {
    super(message);
    this.name = 'MailError';
  }
}

/** Poort naar de mailprovider; in tests vervangen door een mock (nooit echte verzending). */
export interface MailPort {
  send(mail: OutgoingMail): Promise<SentMail>;
}
