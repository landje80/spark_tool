import { Errors, ServerClient } from 'postmark';
import { MailError, type MailPort, type OutgoingMail, type SentMail } from './types.js';

/** Naam in de From-header zonder tekens die de header kunnen breken of misleiden. */
const safeDisplayName = (name: string): string =>
  name
    .replace(/[\r\n"<>\\]/g, '')
    .trim()
    .slice(0, 80) || 'Spark';

/** Officiële Postmark Node.js SDK. Token blijft server-side; nooit vanuit de browser. */
export class PostmarkMailClient implements MailPort {
  private readonly client: ServerClient;

  constructor(serverToken: string) {
    this.client = new ServerClient(serverToken);
  }

  async send(mail: OutgoingMail): Promise<SentMail> {
    try {
      const res = await this.client.sendEmail({
        From: `"${safeDisplayName(mail.fromName)}" <${mail.fromEmail}>`,
        To: mail.to,
        Subject: mail.subject,
        TextBody: mail.textBody,
        HtmlBody: mail.htmlBody,
        ReplyTo: mail.replyTo,
        MessageStream: mail.messageStream,
        Tag: mail.tag,
        TrackOpens: mail.trackOpens,
        TrackLinks: 'None' as never,
        Headers: mail.headers.map((h) => ({ Name: h.name, Value: h.value })),
        Metadata: mail.metadata,
      });
      return { messageId: res.MessageID, submittedAt: new Date(res.SubmittedAt) };
    } catch (err) {
      throw toMailError(err);
    }
  }
}

/** Vertaalt SDK-fouten naar een klein, veilig type (geen request- of adresgegevens). */
export function toMailError(err: unknown): MailError {
  if (err instanceof Errors.InactiveRecipientsError) {
    return new MailError(
      'Ontvanger is bij de mailprovider gedeactiveerd',
      'inactive_recipient',
      err.code,
    );
  }
  if (err instanceof Errors.RateLimitExceededError) {
    return new MailError('Verzendlimiet van de mailprovider bereikt', 'rate_limited', err.code);
  }
  if (err instanceof Errors.InvalidAPIKeyError) {
    return new MailError('API-token van de mailprovider is ongeldig', 'auth', err.code);
  }
  if (err instanceof Errors.ApiInputError) {
    return new MailError('De mailprovider weigerde de invoer', 'invalid_input', err.code);
  }
  if (err instanceof Errors.PostmarkError) {
    return new MailError('De mailprovider gaf een fout', 'unknown', err.code);
  }
  return new MailError('Verbinding met de mailprovider mislukt', 'network');
}
