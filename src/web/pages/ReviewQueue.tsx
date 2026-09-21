import { useState } from 'react';
import { Link } from 'react-router-dom';
import { nl } from '../../shared/i18n/nl';
import { send } from '../api';
import { ErrorNote, Loading } from '../components';
import { fmt, safeHref, useAnnounce, useApi, usePageTitle } from '../lib';
import { useCan } from '../me';

const t = nl.leads;

interface Candidate {
  companyName: string;
  city: string;
  province: keyof typeof nl.province;
  industry: string;
  website: string;
  employeesMin: number | null;
  employeesMax: number | null;
  employeesRationale: string;
  socials: { platform: string; url: string; accountName: string | null }[];
  observations: { kind: 'waarneming' | 'interpretatie'; text: string }[];
  sparkFit: string;
  outreachAngle: string;
  confidence: 'LOW' | 'MEDIUM' | 'HIGH';
  reviewReasons: string[];
  sources: { url: string; title: string | null; type: string }[];
}
interface Existing {
  id: string;
  companyName: string;
  city: string | null;
  province: keyof typeof nl.province;
  industry: string | null;
  website: string | null;
  employeesMin: number | null;
  employeesMax: number | null;
  socials: { platform: string; url: string }[];
}
interface Item {
  id: string;
  matchReason: string | null;
  candidate: Candidate;
  existing: Existing | null;
}

const range = (min: number | null, max: number | null) =>
  min == null && max == null ? t.none : `${min ?? '?'} – ${max ?? '?'}`;

function Link2({ url, label }: { url: string; label?: string | null }) {
  const href = safeHref(url);
  return href ? (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {label || url}
    </a>
  ) : (
    <span>{label || url}</span>
  );
}

export function ReviewQueuePage() {
  usePageTitle(t.reviewTitle);
  const canWrite = useCan('prospect.write');
  const announce = useAnnounce();
  const { data, error, loading, reload } = useApi<{ candidates: Item[] }>('/leads/candidates');
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  async function resolve(id: string, action: 'accept' | 'attach' | 'reject') {
    setBusy(id);
    setFailed(false);
    try {
      await send('POST', `/leads/candidates/${id}/resolve`, { action });
      announce(t.done);
      reload();
    } catch {
      setFailed(true);
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <p>
        <Link to="/prospects">← {t.back}</Link>
      </p>
      <h1>{t.reviewTitle}</h1>
      <p className="muted">{t.reviewIntro}</p>
      {loading && <Loading />}
      {error && <ErrorNote message={nl.common.error} />}
      {failed && <ErrorNote message={t.failed} />}
      {data && data.candidates.length === 0 && <p className="card">{t.empty}</p>}
      <ul className="cards">
        {data?.candidates.map((it) => {
          const c = it.candidate;
          const e = it.existing;
          return (
            <li key={it.id} className="card review">
              <h2>{c.companyName}</h2>
              {it.matchReason && (
                <p className="alert alert--warn">
                  <strong>{t.reason}:</strong> {it.matchReason}
                </p>
              )}
              <div className="compare">
                <section aria-label={t.existing}>
                  <h3>{t.existing}</h3>
                  {e ? (
                    <dl className="dl dl--one">
                      <div>
                        <dt>{t.company}</dt>
                        <dd>
                          <Link to={`/prospects/${e.id}`}>{e.companyName}</Link>
                        </dd>
                      </div>
                      <div>
                        <dt>{t.place}</dt>
                        <dd>{[e.city, nl.province[e.province]].filter(Boolean).join(', ')}</dd>
                      </div>
                      <div>
                        <dt>{t.industry}</dt>
                        <dd>{e.industry ?? t.none}</dd>
                      </div>
                      <div>
                        <dt>{t.website}</dt>
                        <dd>{e.website ? <Link2 url={e.website} /> : t.none}</dd>
                      </div>
                      <div>
                        <dt>{t.employees}</dt>
                        <dd>{range(e.employeesMin, e.employeesMax)}</dd>
                      </div>
                      <div>
                        <dt>{t.socials}</dt>
                        <dd>{e.socials.map((s) => s.platform).join(', ') || t.none}</dd>
                      </div>
                    </dl>
                  ) : (
                    <p className="muted">{t.none}</p>
                  )}
                </section>
                <section aria-label={t.found}>
                  <h3>{t.found}</h3>
                  <dl className="dl dl--one">
                    <div>
                      <dt>{t.company}</dt>
                      <dd>{c.companyName}</dd>
                    </div>
                    <div>
                      <dt>{t.place}</dt>
                      <dd>{[c.city, nl.province[c.province]].join(', ')}</dd>
                    </div>
                    <div>
                      <dt>{t.industry}</dt>
                      <dd>{c.industry}</dd>
                    </div>
                    <div>
                      <dt>{t.website}</dt>
                      <dd>
                        <Link2 url={c.website} />
                      </dd>
                    </div>
                    <div>
                      <dt>{t.employees}</dt>
                      <dd>
                        {range(c.employeesMin, c.employeesMax)}
                        {c.employeesRationale ? ` — ${c.employeesRationale}` : ''}
                      </dd>
                    </div>
                    <div>
                      <dt>{t.socials}</dt>
                      <dd>
                        {c.socials.map((s) => (
                          <span key={s.url} className="chip">
                            <Link2 url={s.url} label={s.platform} />
                          </span>
                        ))}
                      </dd>
                    </div>
                    <div>
                      <dt>{t.confidence}</dt>
                      <dd>{c.confidence}</dd>
                    </div>
                  </dl>
                </section>
              </div>

              {c.reviewReasons.length > 0 && (
                <p>
                  <strong>{t.reviewReasons}:</strong> {c.reviewReasons.join('; ')}
                </p>
              )}
              <p className="pre">
                <strong>{t.fit}:</strong> {c.sparkFit}
              </p>
              <p className="pre">
                <strong>{t.angle}:</strong> {c.outreachAngle}
              </p>
              {c.observations.length > 0 && (
                <>
                  <h3>{t.observations}</h3>
                  <ul className="plain">
                    {c.observations.map((o, i) => (
                      <li key={i}>
                        <strong>{o.kind === 'waarneming' ? t.fact : t.interpretation}:</strong>{' '}
                        {o.text}
                      </li>
                    ))}
                  </ul>
                </>
              )}
              <h3>{t.sources}</h3>
              <ul className="plain">
                {c.sources.map((s) => (
                  <li key={s.url}>
                    <Link2 url={s.url} label={s.title} />
                  </li>
                ))}
              </ul>

              {canWrite && (
                <div className="actions">
                  <button
                    className="btn"
                    disabled={busy === it.id}
                    aria-label={fmt(t.acceptNamed, { name: c.companyName })}
                    onClick={() => void resolve(it.id, 'accept')}
                  >
                    {t.accept}
                  </button>
                  {e && (
                    <button
                      className="btn btn--ghost"
                      disabled={busy === it.id}
                      aria-label={fmt(t.attachNamed, { name: e.companyName })}
                      onClick={() => void resolve(it.id, 'attach')}
                    >
                      {t.attach}
                    </button>
                  )}
                  <button
                    className="btn btn--ghost"
                    disabled={busy === it.id}
                    aria-label={fmt(t.rejectNamed, { name: c.companyName })}
                    onClick={() => void resolve(it.id, 'reject')}
                  >
                    {t.reject}
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}
