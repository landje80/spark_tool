import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { nl } from '../../shared/i18n/nl';
import { BASE, send } from '../api';
import { ErrorNote, Loading } from '../components';
import { fmt, fmtDateTime, useAnnounce, useApi, usePageTitle } from '../lib';
import { useCan } from '../me';

const t = nl.content;

interface SubmissionListItem {
  id: string;
  status: keyof typeof t.submissionStatus;
  topic: string | null;
  createdAt: string;
  customer: { id: string; name: string };
  _count: { assets: number; drafts: number };
}

export function ContentPage() {
  usePageTitle(t.title);
  const { data, loading, error } = useApi<{ items: SubmissionListItem[] }>('/submissions');
  return (
    <>
      <h1>{t.title}</h1>
      {loading && <Loading />}
      {error && <ErrorNote message={nl.common.error} />}
      {data && data.items.length === 0 && <p className="card">{t.empty}</p>}
      <ul className="cards">
        {data?.items.map((s) => (
          <li key={s.id} className="card">
            <h2>
              <Link to={`/content/${s.id}`}>{s.topic ?? s.customer.name}</Link>
            </h2>
            <p className="muted">
              {s.customer.name} · {t.submissionStatus[s.status]}
            </p>
            <p className="muted small">{fmt(t.assets, { count: s._count.assets })}</p>
          </li>
        ))}
      </ul>
    </>
  );
}

interface Asset {
  id: string;
  role: 'ORIGINAL' | 'DERIVATIVE' | 'THUMBNAIL';
  kind: 'IMAGE' | 'VIDEO';
  parentId: string | null;
  originalName: string | null;
}
interface Draft {
  id: string;
  platform: keyof typeof t.platform;
  version: number;
  text: string;
  hashtags: string[];
  cta: string | null;
  altText: string | null;
  status: keyof typeof t.draftStatus;
  feedback: string | null;
}
interface Concept {
  id: string;
  version: number;
  summary: string;
  missingContext: string[];
  createdAt: string;
}
interface SubmissionDetail {
  id: string;
  status: keyof typeof t.submissionStatus;
  topic: string | null;
  note: string | null;
  failureReason: string | null;
  customer: { id: string; name: string; allowedPlatforms: string[] };
  assets: Asset[];
  concepts: Concept[];
  drafts: Draft[];
}

function fileUrl(id: string): string {
  return `${BASE}/api/media-assets/${id}/file`;
}

function MediaGrid({ assets }: { assets: Asset[] }) {
  const originals = assets.filter((a) => a.role === 'ORIGINAL');
  const thumbFor = (id: string) => assets.find((a) => a.parentId === id && a.role === 'THUMBNAIL');
  return (
    <ul className="mediagrid">
      {originals.map((o) => {
        const thumb = thumbFor(o.id);
        const label = `${o.originalName ?? t.kind[o.kind]} (${nl.common.opensNewTab})`;
        return (
          <li key={o.id}>
            <a href={fileUrl(o.id)} target="_blank" rel="noopener noreferrer">
              {o.kind === 'IMAGE' ? (
                <img src={fileUrl(thumb?.id ?? o.id)} alt="" loading="lazy" />
              ) : thumb ? (
                <img src={fileUrl(thumb.id)} alt="" loading="lazy" />
              ) : (
                <span className="mediagrid__placeholder" aria-hidden="true">
                  {t.kind[o.kind]}
                </span>
              )}
              <span className="sr-only">{label}</span>
            </a>
          </li>
        );
      })}
    </ul>
  );
}

function DraftEditor({
  draft,
  canReview,
  onChange,
}: {
  draft: Draft;
  canReview: boolean;
  onChange: () => void;
}) {
  const announce = useAnnounce();
  const [text, setText] = useState(draft.text);
  const [hashtags, setHashtags] = useState(draft.hashtags.join(', '));
  const [cta, setCta] = useState(draft.cta ?? '');
  const [altText, setAltText] = useState(draft.altText ?? '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [askingChanges, setAskingChanges] = useState(false);
  const [changesText, setChangesText] = useState('');
  const headingRef = useRef<HTMLHeadingElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);

  const editable = ['DRAFT', 'IN_REVIEW', 'CHANGES_REQUESTED'].includes(draft.status);

  // Na een statuswijziging verandert het hele kaartje van vorm (formulier <-> alleen-lezen); de
  // knop waarop net geklikt is bestaat dan niet meer, dus de focus gaat expliciet naar de kop.
  useEffect(() => {
    headingRef.current?.focus();
  }, [draft.status]);
  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await send('PATCH', `/drafts/${draft.id}`, {
        text,
        hashtags: hashtags
          .split(',')
          .map((h) => h.trim())
          .filter(Boolean),
        cta: cta || null,
        altText: altText || null,
      });
      announce(nl.common.save);
      onChange();
    } catch {
      setError(t.saveFailed);
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(
    to: 'IN_REVIEW' | 'APPROVED' | 'CHANGES_REQUESTED' | 'DISCARDED',
    feedback: string | null,
    okMessage: string,
  ) {
    setBusy(true);
    setError('');
    try {
      await send('POST', `/drafts/${draft.id}/status`, { to, feedback });
      announce(okMessage);
      setAskingChanges(false);
      onChange();
    } catch {
      setError(t.actionFailed);
    } finally {
      setBusy(false);
    }
  }

  async function submitChanges(e: FormEvent) {
    e.preventDefault();
    if (!changesText.trim()) return;
    await setStatus('CHANGES_REQUESTED', changesText.trim(), t.changesRequested);
  }

  async function markPublished() {
    if (!window.confirm(fmt(t.markPublishedConfirm, { platform: t.platform[draft.platform] })))
      return;
    setBusy(true);
    setError('');
    try {
      await send('POST', `/drafts/${draft.id}/mark-published`);
      announce(t.markedPublished);
      onChange();
    } catch {
      setError(t.actionFailed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="card">
      <div className="page-head">
        <h3 tabIndex={-1} ref={headingRef}>
          {t.platform[draft.platform]}
        </h3>
        <span className={`badge badge--draft-${draft.status.toLowerCase()}`}>
          {t.draftStatus[draft.status]}
        </span>
      </div>
      {draft.feedback && (
        <p className="alert alert--warn">
          <strong>{t.feedback}:</strong> {draft.feedback}
        </p>
      )}
      {error && (
        <div ref={errorRef} tabIndex={-1}>
          <ErrorNote message={error} />
        </div>
      )}
      {canReview && editable ? (
        <form onSubmit={(e) => void save(e)} className="form">
          <div className="field">
            <label htmlFor={`text-${draft.id}`}>{t.text}</label>
            <textarea
              id={`text-${draft.id}`}
              rows={5}
              maxLength={3000}
              value={text}
              onChange={(e) => setText(e.target.value)}
              required
            />
          </div>
          <div className="field">
            <label htmlFor={`hash-${draft.id}`}>{t.hashtags}</label>
            <input
              id={`hash-${draft.id}`}
              value={hashtags}
              onChange={(e) => setHashtags(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor={`cta-${draft.id}`}>{t.cta}</label>
            <input
              id={`cta-${draft.id}`}
              value={cta}
              onChange={(e) => setCta(e.target.value)}
              maxLength={300}
            />
          </div>
          <div className="field">
            <label htmlFor={`alt-${draft.id}`}>{t.altText}</label>
            <input
              id={`alt-${draft.id}`}
              value={altText}
              onChange={(e) => setAltText(e.target.value)}
              maxLength={500}
            />
          </div>
          <div className="actions">
            <button className="btn btn--ghost" type="submit" disabled={busy}>
              {t.save}
            </button>
            {draft.status === 'DRAFT' && (
              <button
                type="button"
                className="btn"
                disabled={busy}
                onClick={() => void setStatus('APPROVED', null, t.approved)}
              >
                {t.approve}
              </button>
            )}
            {draft.status !== 'CHANGES_REQUESTED' && !askingChanges && (
              <button
                type="button"
                className="btn btn--ghost"
                disabled={busy}
                onClick={() => setAskingChanges(true)}
              >
                {t.requestChanges}
              </button>
            )}
          </div>
          {askingChanges && (
            <div className="field">
              <label htmlFor={`changes-${draft.id}`}>{t.requestChangesPrompt}</label>
              <textarea
                id={`changes-${draft.id}`}
                rows={2}
                maxLength={2000}
                value={changesText}
                onChange={(e) => setChangesText(e.target.value)}
                required
              />
              <div className="actions">
                <button
                  type="button"
                  className="btn"
                  disabled={busy || !changesText.trim()}
                  onClick={(e) => void submitChanges(e)}
                >
                  {t.requestChangesSend}
                </button>
                <button
                  type="button"
                  className="btn btn--ghost"
                  onClick={() => {
                    setAskingChanges(false);
                    setChangesText('');
                  }}
                >
                  {t.requestChangesCancel}
                </button>
              </div>
            </div>
          )}
        </form>
      ) : (
        <>
          <p className="pre">{draft.text}</p>
          {draft.hashtags.length > 0 && <p className="muted small">{draft.hashtags.join(' ')}</p>}
          {draft.cta && <p className="muted small">{draft.cta}</p>}
          {canReview && draft.status === 'APPROVED' && (
            <button className="btn" disabled={busy} onClick={() => void markPublished()}>
              {t.markPublished}
            </button>
          )}
        </>
      )}
      <p className="hint">{t.publishHelp}</p>
    </li>
  );
}

export function SubmissionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const canReview = useCan('content.review');
  const announce = useAnnounce();
  const { data, loading, error, reload } = useApi<SubmissionDetail>(
    id ? `/submissions/${id}` : null,
  );
  const [busy, setBusy] = useState(false);
  const [genError, setGenError] = useState('');
  usePageTitle(data?.topic ?? t.title);

  async function generate() {
    setBusy(true);
    setGenError('');
    try {
      await send('POST', `/submissions/${id}/generate-concept`);
      announce(t.conceptGenerated);
      reload();
    } catch {
      setGenError(t.generateFailed);
    } finally {
      setBusy(false);
    }
  }

  async function advance(to: 'READY_TO_PUBLISH' | 'ARCHIVED') {
    setBusy(true);
    try {
      await send('POST', `/submissions/${id}/advance`, { to });
      announce(to === 'READY_TO_PUBLISH' ? t.readyToPublishDone : t.archived);
      reload();
    } catch {
      setGenError(t.actionFailed);
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <Loading />;
  if (error || !data) return <ErrorNote message={nl.common.error} />;

  const canGenerate = ['TECHNICAL_CHECK', 'DRAFT_READY', 'CHANGES_REQUESTED', 'FAILED'].includes(
    data.status,
  );
  const latestConcept = data.concepts[0];

  return (
    <>
      <p>
        <Link to="/content">← {t.title}</Link>
      </p>
      <div className="page-head">
        <h1>{data.topic ?? data.customer.name}</h1>
        <span className="badge">{t.submissionStatus[data.status]}</span>
      </div>
      <p className="muted">
        {t.customer}: <Link to={`/customers/${data.customer.id}`}>{data.customer.name}</Link>
      </p>
      {data.note && <p className="pre">{data.note}</p>}
      {data.failureReason && <ErrorNote message={data.failureReason} />}

      <section aria-labelledby="h-media">
        <h2 id="h-media">
          {fmt(t.assets, { count: data.assets.filter((a) => a.role === 'ORIGINAL').length })}
        </h2>
        <MediaGrid assets={data.assets} />
      </section>

      {canReview && (
        <section aria-labelledby="h-concept">
          <h2 id="h-concept">{t.drafts}</h2>
          {genError && <ErrorNote message={genError} />}
          {latestConcept && (
            <p className="muted small">
              {fmt(nl.customers.version, { version: latestConcept.version })} ·{' '}
              {fmtDateTime(latestConcept.createdAt)}
            </p>
          )}
          {latestConcept && latestConcept.missingContext.length > 0 && (
            <div className="alert alert--warn" role="status">
              <strong>{t.missingContext}:</strong>
              <ul className="plain">
                {latestConcept.missingContext.map((m, i) => (
                  <li key={i}>{m}</li>
                ))}
              </ul>
            </div>
          )}
          {canGenerate && (
            <button className="btn" disabled={busy} onClick={() => void generate()}>
              {busy
                ? t.generating
                : data.drafts.length > 0
                  ? t.regenerateConcept
                  : t.generateConcept}
            </button>
          )}
          {data.drafts.length === 0 ? (
            <p className="muted">{t.noDrafts}</p>
          ) : (
            <ul className="cards">
              {data.drafts.map((d) => (
                <DraftEditor key={d.id} draft={d} canReview={canReview} onChange={reload} />
              ))}
            </ul>
          )}
          {data.status === 'APPROVED' && (
            <button
              className="btn btn--ghost"
              disabled={busy}
              onClick={() => void advance('READY_TO_PUBLISH')}
            >
              {t.readyToPublish}
            </button>
          )}
          {(data.status === 'PUBLISHED' || data.status === 'FAILED') && (
            <button
              className="btn btn--ghost"
              disabled={busy}
              onClick={() => void advance('ARCHIVED')}
            >
              {t.archive}
            </button>
          )}
        </section>
      )}
    </>
  );
}
