import { useEffect, useRef, useState, type FormEvent } from 'react';
import { nl } from '../../shared/i18n/nl';
import { ApiError, send } from '../api';
import { ErrorNote, Loading } from '../components';
import { fmt, fmtDateTime, useAnnounce, useApi } from '../lib';

const t = nl.outreach;

export interface DraftRow {
  id: string;
  subject: string;
  status: string;
  createdAt: string;
}
export interface EmailRow {
  id: string;
  subject: string;
  status: keyof typeof t.emailStatus;
  sentAt: string | null;
  deliveredAt: string | null;
  openedAt: string | null;
  bounceType: string | null;
  toEmail: string;
}

interface DraftFull {
  id: string;
  subject: string;
  textBody: string;
  status: string;
}
interface Preview {
  from: { email: string; name: string };
  to: string;
  subject: string;
  paragraphs: string[];
  footer: string[];
  warnings: (keyof typeof t.warn)[];
  confirmToken: string;
}

/** Vertaalt een API-fout naar een begrijpelijke melding op basis van de redencode. */
function reasonMessage(err: unknown): string {
  if (err instanceof ApiError) {
    const reason = (err.details as { reason?: string } | undefined)?.reason;
    if (reason && reason in t.reason) return t.reason[reason as keyof typeof t.reason];
  }
  return t.genericError;
}

function Editor({
  draftId,
  defaultTo,
  onDone,
}: {
  draftId: string;
  defaultTo: string;
  onDone: (sent: boolean) => void;
}) {
  const { data, loading } = useApi<DraftFull>(`/outreach/drafts/${draftId}`);
  const announce = useAnnounce();
  const [subject, setSubject] = useState<string | null>(null);
  const [body, setBody] = useState<string | null>(null);
  const [to, setTo] = useState(defaultTo);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [followUp, setFollowUp] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const previewHeadingRef = useRef<HTMLHeadingElement>(null);
  const editorHeadingRef = useRef<HTMLHeadingElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);

  // Focus volgt de inhoud: naar het voorbeeld bij openen, terug naar de editor-kop bij "Terug".
  useEffect(() => {
    (preview ? previewHeadingRef : editorHeadingRef).current?.focus();
  }, [preview]);
  // Een fout krijgt de focus zodat schermlezers hem meteen voorlezen (in plaats van op de knop te blijven).
  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  if (loading || !data) return <Loading />;
  const subj = subject ?? data.subject;
  const text = body ?? data.textBody;

  async function save(): Promise<boolean> {
    try {
      await send('PATCH', `/outreach/drafts/${draftId}`, { subject: subj, textBody: text });
      return true;
    } catch (err) {
      setError(
        err instanceof ApiError && err.code === 'VALIDATION_ERROR'
          ? nl.crm.form.fixErrors
          : t.genericError,
      );
      return false;
    }
  }

  async function onSave(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    if (await save()) announce(t.savedOk);
    setBusy(false);
  }

  async function onPreview() {
    setError('');
    setBusy(true);
    try {
      if (!(await save())) return;
      setPreview(await send<Preview>('POST', `/outreach/drafts/${draftId}/prepare-send`, { to }));
      setConfirmed(false);
    } catch (err) {
      setError(reasonMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function onSend() {
    if (!preview) return;
    setError('');
    setBusy(true);
    try {
      await send('POST', `/outreach/drafts/${draftId}/send`, {
        to: preview.to,
        confirmToken: preview.confirmToken,
        followUpDays: followUp ? Number(followUp) : null,
      });
      announce(t.sentOk);
      onDone(true);
    } catch (err) {
      setError(reasonMessage(err));
      // Bevestiging ongeldig of inhoud gewijzigd: terug naar bewerken/voorbeeld.
      if (err instanceof ApiError && err.code === 'CONFLICT') setPreview(null);
    } finally {
      setBusy(false);
    }
  }

  if (preview) {
    return (
      <section className="preview" aria-labelledby="h-preview">
        <h3 id="h-preview" tabIndex={-1} ref={previewHeadingRef}>
          {t.previewTitle}
        </h3>
        {error && (
          <div ref={errorRef} tabIndex={-1}>
            <ErrorNote message={error} />
          </div>
        )}
        {preview.warnings.map((w) => (
          <p key={w} className="alert alert--warn">
            {t.warn[w]}
          </p>
        ))}
        <dl className="dl dl--one">
          <div>
            <dt>{t.from}</dt>
            <dd>
              {preview.from.name} &lt;{preview.from.email}&gt;
            </dd>
          </div>
          <div>
            <dt>{t.to}</dt>
            <dd>{preview.to}</dd>
          </div>
          <div>
            <dt>{t.subject}</dt>
            <dd>{preview.subject}</dd>
          </div>
        </dl>
        <div className="mailbox" role="group" aria-label={t.previewTitle}>
          {preview.paragraphs.map((p, i) => (
            <p key={i} className="pre">
              {p}
            </p>
          ))}
          <p className="muted small" id="footer-label">
            {t.footerLabel}:
          </p>
          <div aria-labelledby="footer-label">
            {preview.footer.map((p, i) => (
              <p key={i} className="pre muted small">
                {p}
              </p>
            ))}
          </div>
        </div>
        <label>
          {t.followUp}
          <select value={followUp} onChange={(e) => setFollowUp(e.target.value)}>
            <option value="">{t.followNone}</option>
            {[3, 7, 14].map((n) => (
              <option key={n} value={n}>
                {fmt(t.followDays, { n })}
              </option>
            ))}
          </select>
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
          />
          {t.confirmCheck}
        </label>
        {!confirmed && (
          <p className="hint" id="send-hint">
            {t.confirmHint}
          </p>
        )}
        <div className="actions">
          <button
            className="btn"
            aria-disabled={!confirmed || busy}
            aria-describedby={!confirmed ? 'send-hint' : undefined}
            onClick={() => {
              if (confirmed && !busy) void onSend();
            }}
          >
            {busy ? t.sending : t.sendNow}
          </button>
          <button className="btn btn--ghost" disabled={busy} onClick={() => setPreview(null)}>
            {t.back}
          </button>
        </div>
      </section>
    );
  }

  return (
    <form onSubmit={(e) => void onSave(e)} className="form editor" aria-labelledby="h-editor">
      <h3 id="h-editor" tabIndex={-1} ref={editorHeadingRef}>
        {t.editorTitle}
      </h3>
      {error && (
        <div ref={errorRef} tabIndex={-1}>
          <ErrorNote message={error} />
        </div>
      )}
      <div className="field">
        <label htmlFor="ol-to">{t.recipient}</label>
        <input
          id="ol-to"
          type="email"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          autoComplete="off"
          required
        />
      </div>
      <div className="field">
        <label htmlFor="ol-subject">{t.subject}</label>
        <input
          id="ol-subject"
          value={subj}
          maxLength={200}
          onChange={(e) => setSubject(e.target.value)}
          required
        />
      </div>
      <div className="field">
        <label htmlFor="ol-body">{t.body}</label>
        <textarea
          id="ol-body"
          rows={12}
          value={text}
          maxLength={10000}
          onChange={(e) => setBody(e.target.value)}
          aria-describedby="ol-body-hint"
          required
        />
        <p className="hint" id="ol-body-hint">
          {t.bodyHint}
        </p>
      </div>
      <div className="actions">
        <button className="btn btn--ghost" type="submit" disabled={busy}>
          {t.save}
        </button>
        <button
          className="btn"
          type="button"
          disabled={busy || !to}
          onClick={() => void onPreview()}
        >
          {t.preview}
        </button>
        <button className="btn btn--ghost" type="button" onClick={() => onDone(false)}>
          {nl.common.cancel}
        </button>
      </div>
    </form>
  );
}

export function OutreachSection({
  prospectId,
  contactEmail,
  drafts,
  emails,
  canPrepare,
  canSend,
  canWrite,
  onChange,
}: {
  prospectId: string;
  contactEmail: string | null;
  drafts: DraftRow[];
  emails: EmailRow[];
  canPrepare: boolean;
  canSend: boolean;
  canWrite: boolean;
  onChange: () => void;
}) {
  const announce = useAnnounce();
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [reply, setReply] = useState('');
  const [replyNo, setReplyNo] = useState(false);
  const draftsHeadingRef = useRef<HTMLHeadingElement>(null);

  const open = drafts.filter((d) => d.status === 'DRAFT');

  async function create() {
    setBusy(true);
    setError('');
    try {
      const d = await send<{ id: string }>('POST', `/prospects/${prospectId}/drafts`);
      onChange();
      setEditing(d.id);
    } catch {
      setError(nl.common.error);
    } finally {
      setBusy(false);
    }
  }
  async function discard(id: string) {
    if (!window.confirm(t.discardConfirm)) return;
    try {
      await send('POST', `/outreach/drafts/${id}/discard`);
      announce(t.discardOk);
      onChange();
      // De knop die de focus had verdwijnt uit de conceptenlijst; zet de focus op een
      // stabiel punt in plaats van hem naar <body> te laten vallen.
      draftsHeadingRef.current?.focus();
    } catch {
      setError(nl.common.error);
    }
  }
  async function addReply(e: FormEvent) {
    e.preventDefault();
    setError('');
    try {
      await send('POST', `/prospects/${prospectId}/replies`, {
        text: reply,
        notInterested: replyNo,
      });
      setReply('');
      setReplyNo(false);
      announce(t.replyOk);
      onChange();
    } catch (err) {
      setError(
        err instanceof ApiError && err.code === 'INVALID_TRANSITION'
          ? nl.errors.INVALID_TRANSITION
          : nl.common.error,
      );
    }
  }
  async function block() {
    if (!contactEmail || !window.confirm(fmt(t.blockConfirm, { email: contactEmail }))) return;
    try {
      await send('POST', '/outreach/suppressions', { email: contactEmail });
      announce(t.blocked);
      onChange();
    } catch {
      setError(nl.common.error);
    }
  }

  return (
    <section className="card" aria-labelledby="h-out">
      <h2 id="h-out">{t.title}</h2>
      <p className="muted">
        {t.contact}: {contactEmail ?? t.noContact}
      </p>
      {error && <ErrorNote message={error} />}

      {editing ? (
        <Editor
          draftId={editing}
          defaultTo={contactEmail ?? ''}
          onDone={() => {
            setEditing(null);
            onChange();
          }}
        />
      ) : (
        <>
          <h3 ref={draftsHeadingRef} tabIndex={-1}>
            {t.drafts}
          </h3>
          {open.length === 0 ? (
            <p className="muted">{t.noDrafts}</p>
          ) : (
            <ul className="plain">
              {open.map((d) => (
                <li key={d.id} className="taskrow">
                  <span>
                    <strong>{d.subject}</strong>{' '}
                    <span className="muted small">{fmtDateTime(d.createdAt)}</span>
                  </span>
                  {canPrepare && (
                    <span className="actions">
                      <button
                        className="btn btn--ghost"
                        aria-label={`${t.edit}: ${d.subject}`}
                        onClick={() => setEditing(d.id)}
                      >
                        {t.edit}
                      </button>
                      <button
                        className="btn btn--ghost"
                        aria-label={`${t.discard}: ${d.subject}`}
                        onClick={() => void discard(d.id)}
                      >
                        {t.discard}
                      </button>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
          {canPrepare && (
            <button className="btn" disabled={busy} onClick={() => void create()}>
              {busy ? t.creating : t.newDraft}
            </button>
          )}
        </>
      )}

      <h3>{t.sent}</h3>
      {emails.length === 0 ? (
        <p className="muted">{t.noSent}</p>
      ) : (
        <ul className="plain">
          {emails.map((m) => (
            <li key={m.id}>
              <strong>{m.subject}</strong> ·{' '}
              <span className={`badge badge--mail-${m.status.toLowerCase()}`}>
                {t.emailStatus[m.status]}
              </span>
              <div className="muted small">
                {m.toEmail}
                {m.sentAt ? ` · ${fmtDateTime(m.sentAt)}` : ''}
                {m.openedAt ? ` · ${t.opened} ${fmtDateTime(m.openedAt)}` : ''}
                {m.bounceType ? ` · ${m.bounceType}` : ''}
              </div>
            </li>
          ))}
        </ul>
      )}

      {canWrite && (
        <form onSubmit={(e) => void addReply(e)} className="inline-form" aria-labelledby="h-reply">
          <h3 className="full" id="h-reply">
            {t.replyTitle}
          </h3>
          <p className="muted full" id="reply-help">
            {t.replyHelp}
          </p>
          <label className="grow">
            {t.replyText}
            <textarea
              value={reply}
              rows={3}
              maxLength={5000}
              onChange={(e) => setReply(e.target.value)}
              aria-describedby="reply-help"
              required
            />
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={replyNo}
              onChange={(e) => setReplyNo(e.target.checked)}
            />
            {t.replyNo}
          </label>
          <button className="btn" type="submit">
            {t.replyAdd}
          </button>
        </form>
      )}

      {canSend && contactEmail && (
        <p>
          <button
            className="btn btn--ghost"
            aria-describedby="block-help"
            onClick={() => void block()}
          >
            {t.block}
          </button>{' '}
          <span className="muted small" id="block-help">
            {t.blockHelp}
          </span>
        </p>
      )}
    </section>
  );
}
