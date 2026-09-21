import { Link } from 'react-router-dom';
import { nl } from '../../shared/i18n/nl';
import { ErrorNote, Loading } from '../components';
import { fmt, fmtDateTime, useApi, usePageTitle, type ProspectStatus } from '../lib';

interface Dashboard {
  kpis: {
    newCount: number;
    dueToday: number;
    overdue: number;
    draftsToReview: number;
    emailsSent: number;
    replies: number;
    failedJobs: number;
  };
  funnel: { status: ProspectStatus; count: number }[];
  byStatus: { key: ProspectStatus; count: number }[];
  byCity: { key: string | null; count: number }[];
  byProvince: { key: keyof typeof nl.province; count: number }[];
  byIndustry: { key: string | null; count: number }[];
  recentRuns: {
    id: string;
    startedAt: string;
    status: string;
    acceptedCount: number;
    duplicateCount: number;
    reviewCount: number;
    errorMessage: string | null;
  }[];
}

function Bars({ rows }: { rows: { label: string; count: number }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  if (!rows.length) return <p className="muted">{nl.crm.dashboard.noData}</p>;
  return (
    <ul className="bars">
      {rows.map((r) => (
        <li key={r.label}>
          <span className="bars__label">{r.label}</span>
          <span className="bars__track" aria-hidden="true">
            <span className="bars__fill" style={{ width: `${(r.count / max) * 100}%` }} />
          </span>
          <span className="bars__count">{r.count}</span>
        </li>
      ))}
    </ul>
  );
}

export function DashboardPage() {
  const { data, error, loading } = useApi<Dashboard>('/dashboard');
  const t = nl.crm.dashboard;
  usePageTitle(t.title);
  if (loading) return <Loading />;
  if (error || !data) return <ErrorNote message={nl.common.error} />;
  const k = data.kpis;
  const kpis: [string, number, string, string?][] = [
    [t.kpiNew, k.newCount, '/prospects?status=NEW'],
    [t.kpiToday, k.dueToday, '/prospects?due=today', k.dueToday ? 'kpi--today' : undefined],
    [t.kpiOverdue, k.overdue, '/prospects?due=overdue', k.overdue ? 'kpi--overdue' : undefined],
    [t.kpiDrafts, k.draftsToReview, '/prospects?status=OUTREACH_PREPARED'],
    [t.kpiSent, k.emailsSent, '/prospects?status=EMAILED'],
    [t.kpiReplies, k.replies, '/prospects?status=REPLY_RECEIVED'],
    [t.kpiFailedJobs, k.failedJobs, '/dashboard', k.failedJobs ? 'kpi--overdue' : undefined],
  ];
  return (
    <>
      <h1>{t.title}</h1>
      <ul className="kpis">
        {kpis.map(([label, value, to, cls]) => (
          <li key={label}>
            <Link to={to} className={`kpi ${cls ?? ''}`}>
              <span className="kpi__value">{value}</span>
              <span className="kpi__label">{label}</span>
            </Link>
          </li>
        ))}
      </ul>
      <div className="grid-2">
        <section className="card" aria-labelledby="h-funnel">
          <h2 id="h-funnel">{t.funnel}</h2>
          <Bars rows={data.funnel.map((f) => ({ label: nl.status[f.status], count: f.count }))} />
        </section>
        <section className="card" aria-labelledby="h-status">
          <h2 id="h-status">{t.byStatus}</h2>
          <Bars rows={data.byStatus.map((f) => ({ label: nl.status[f.key], count: f.count }))} />
        </section>
        <section className="card" aria-labelledby="h-city">
          <h2 id="h-city">{t.byCity}</h2>
          <Bars rows={data.byCity.map((f) => ({ label: f.key ?? t.unknown, count: f.count }))} />
        </section>
        <section className="card" aria-labelledby="h-prov">
          <h2 id="h-prov">{t.byProvince}</h2>
          <Bars
            rows={data.byProvince.map((f) => ({
              label: nl.province[f.key] ?? t.unknown,
              count: f.count,
            }))}
          />
        </section>
        <section className="card" aria-labelledby="h-ind">
          <h2 id="h-ind">{t.byIndustry}</h2>
          <Bars
            rows={data.byIndustry.map((f) => ({ label: f.key ?? t.unknown, count: f.count }))}
          />
        </section>
        <section className="card" aria-labelledby="h-runs">
          <h2 id="h-runs">{t.runs}</h2>
          {data.recentRuns.length === 0 ? (
            <p className="muted">{t.noRuns}</p>
          ) : (
            <ul className="plain">
              {data.recentRuns.map((r) => (
                <li key={r.id}>
                  <strong>{fmtDateTime(r.startedAt)}</strong> · {r.status} · {r.acceptedCount}{' '}
                  {fmt(t.runLine, { dup: r.duplicateCount, rev: r.reviewCount })}
                  {r.errorMessage && <span className="muted"> — {r.errorMessage}</span>}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
