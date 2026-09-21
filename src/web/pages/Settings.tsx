import { useState } from 'react';
import { nl } from '../../shared/i18n/nl';
import { ApiError, send } from '../api';
import { ErrorNote, Loading } from '../components';
import { fmt, fmtDateTime, useAnnounce, useApi, usePageTitle } from '../lib';
import { useCan } from '../me';

const t = nl.settings;

interface Integrations {
  anthropic: { apiKeyPresent: boolean; leadModel: string | null; contentModel: string | null };
  postmark: { tokenPresent: boolean; fromEmail: string | null; webhookSecretPresent: boolean };
  entra: { tenantConfigured: boolean };
  leadGeneration: {
    enabled: boolean;
    configured: boolean;
    dailyTarget: number;
    maxDailyCostUsd: number;
    spentTodayUsd: number;
    lastSuccessfulRunAt: string | null;
  };
  jobs: {
    pending: number;
    dead: number;
    lastFailure: { type: string; lastError: string | null; createdAt: string } | null;
  };
}
interface Run {
  id: string;
  startedAt: string;
  status: string;
  acceptedCount: number;
  duplicateCount: number;
  reviewCount: number;
  inputTokens: number;
  outputTokens: number;
  webSearchRequests: number;
  estimatedCostUsd: number;
  errorMessage: string | null;
}

const usd = (n: number) => `$${n.toFixed(2)}`;
const yesNo = (ok: boolean) => (ok ? t.present : t.missing);

function Status({ ok }: { ok: boolean }) {
  // Tekst + symbool, nooit alleen kleur.
  return (
    <span className={ok ? 'status-ok' : 'status-missing'}>
      {ok ? `✓ ${t.present}` : `✕ ${t.missing}`}
    </span>
  );
}

export function SettingsPage() {
  usePageTitle(t.title);
  const canManage = useCan('settings.manage');
  const canRun = useCan('lead.run');
  const announce = useAnnounce();
  const integrations = useApi<Integrations>(canManage ? '/admin/integrations' : null);
  const runs = useApi<{ runs: Run[] }>('/leads/runs');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const i = integrations.data;

  async function toggle(enabled: boolean) {
    setError('');
    try {
      await send('POST', '/admin/leadgen', { enabled });
      integrations.reload();
    } catch {
      setError(t.toggleFailed);
    }
  }
  async function runNow() {
    setError('');
    setMessage('');
    try {
      await send('POST', '/leads/runs');
      setMessage(t.runQueued);
      announce(t.runQueued);
      runs.reload();
    } catch (err) {
      const notConfigured =
        err instanceof ApiError &&
        (err.details as { reason?: string } | undefined)?.reason === 'not_configured';
      const queued =
        err instanceof ApiError &&
        (err.details as { reason?: string } | undefined)?.reason === 'already_queued';
      setError(notConfigured ? t.notConfigured : queued ? t.alreadyQueued : t.runFailed);
    }
  }

  return (
    <>
      <h1>{t.title}</h1>
      {error && <ErrorNote message={error} />}
      {message && (
        <p className="notice" role="status">
          {message}
        </p>
      )}

      <section className="card" aria-labelledby="h-leadgen">
        <h2 id="h-leadgen">{t.leadgen}</h2>
        {canManage && i && (
          <>
            <label className="check">
              <input
                type="checkbox"
                checked={i.leadGeneration.enabled}
                onChange={(e) => void toggle(e.target.checked)}
              />
              {t.leadgenEnabled}
            </label>
            <p className="muted">{t.leadgenHelp}</p>
            {!i.leadGeneration.configured && <p className="alert alert--warn">{t.notConfigured}</p>}
            <dl className="dl">
              <div>
                <dt>{t.spentToday}</dt>
                <dd>
                  {usd(i.leadGeneration.spentTodayUsd)} / {usd(i.leadGeneration.maxDailyCostUsd)} (
                  {t.dailyCap})
                </dd>
              </div>
              <div>
                <dt>{t.dailyTarget}</dt>
                <dd>{i.leadGeneration.dailyTarget}</dd>
              </div>
              <div>
                <dt>{t.lastSuccess}</dt>
                <dd>
                  {i.leadGeneration.lastSuccessfulRunAt
                    ? fmtDateTime(i.leadGeneration.lastSuccessfulRunAt)
                    : t.never}
                </dd>
              </div>
            </dl>
          </>
        )}
        {canRun && (
          <button className="btn" onClick={() => void runNow()}>
            {t.runNow}
          </button>
        )}
        <h3>{t.runs}</h3>
        {runs.loading && <Loading />}
        {runs.data && runs.data.runs.length === 0 && <p className="muted">{t.noRuns}</p>}
        <ul className="plain">
          {runs.data?.runs.map((r) => (
            <li key={r.id}>
              <strong>{fmtDateTime(r.startedAt)}</strong> · {r.status} ·{' '}
              {fmt(t.runSummary, {
                acc: r.acceptedCount,
                dup: r.duplicateCount,
                rev: r.reviewCount,
              })}
              <div className="muted small">
                {t.cost}: {usd(r.estimatedCostUsd)} · {t.tokens}:{' '}
                {r.inputTokens.toLocaleString('nl-NL')} / {r.outputTokens.toLocaleString('nl-NL')} ·{' '}
                {t.searches}: {r.webSearchRequests}
              </div>
              {r.errorMessage && <div className="muted small">{r.errorMessage}</div>}
            </li>
          ))}
        </ul>
      </section>

      {!canManage && <p className="muted">{t.noAccess}</p>}
      {canManage && integrations.loading && <Loading />}
      {canManage && i && (
        <>
          <section className="card" aria-labelledby="h-int">
            <h2 id="h-int">{t.integrations}</h2>
            <p className="muted">{t.integrationsHelp}</p>
            <dl className="dl">
              <div>
                <dt>
                  {t.anthropic} — {t.apiKey}
                </dt>
                <dd>
                  <Status ok={i.anthropic.apiKeyPresent} />
                </dd>
              </div>
              <div>
                <dt>{t.leadModel}</dt>
                <dd>{i.anthropic.leadModel ?? t.missing}</dd>
              </div>
              <div>
                <dt>{t.contentModel}</dt>
                <dd>{i.anthropic.contentModel ?? t.missing}</dd>
              </div>
              <div>
                <dt>
                  {t.postmark} — {t.serverToken}
                </dt>
                <dd>
                  <Status ok={i.postmark.tokenPresent} />
                </dd>
              </div>
              <div>
                <dt>{t.fromEmail}</dt>
                <dd>{i.postmark.fromEmail ?? t.missing}</dd>
              </div>
              <div>
                <dt>{t.webhookSecret}</dt>
                <dd>{yesNo(i.postmark.webhookSecretPresent)}</dd>
              </div>
              <div>
                <dt>
                  {t.entra} — {t.tenant}
                </dt>
                <dd>
                  <Status ok={i.entra.tenantConfigured} />
                </dd>
              </div>
            </dl>
          </section>
          <section className="card" aria-labelledby="h-jobs">
            <h2 id="h-jobs">{t.jobs}</h2>
            <dl className="dl">
              <div>
                <dt>{t.jobsPending}</dt>
                <dd>{i.jobs.pending}</dd>
              </div>
              <div>
                <dt>{t.jobsDead}</dt>
                <dd>{i.jobs.dead}</dd>
              </div>
              {i.jobs.lastFailure && (
                <div>
                  <dt>{t.lastFailure}</dt>
                  <dd>
                    {i.jobs.lastFailure.type}: {i.jobs.lastFailure.lastError ?? '–'}
                  </dd>
                </div>
              )}
            </dl>
          </section>
        </>
      )}
    </>
  );
}
