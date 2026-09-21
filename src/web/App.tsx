import { useEffect, useState } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { BASE, api, setCsrfToken, type Me } from './api';
import { nl } from '../shared/i18n/nl';

function LoginPage() {
  const denied = new URLSearchParams(useLocation().search).get('error') === 'denied';
  const returnTo = encodeURIComponent(`${BASE}/dashboard`);
  return (
    <main className="center-page" id="main">
      <div className="card" style={{ maxWidth: 420, width: '100%' }}>
        <div className="brand" aria-hidden="true">
          SPARK<span>.</span>
        </div>
        <h1>{nl.login.title}</h1>
        <p className="muted">{nl.login.intro}</p>
        {denied && (
          <p className="alert" role="alert">
            {nl.login.denied}
          </p>
        )}
        {/* Volledige navigatie (geen fetch): de server start de OIDC-flow met redirect. */}
        <a className="btn" href={`${BASE}/auth/login?returnTo=${returnTo}`}>
          {nl.login.button}
        </a>
      </div>
    </main>
  );
}

function Placeholder({ title }: { title: string }) {
  return (
    <>
      <h1>{title}</h1>
      <p className="muted">Deze pagina wordt in een volgende fase opgebouwd.</p>
    </>
  );
}

const NAV = [
  ['dashboard', nl.nav.dashboard],
  ['prospects', nl.nav.prospects],
  ['tasks', nl.nav.tasks],
  ['customers', nl.nav.customers],
  ['content', nl.nav.content],
  ['settings', nl.nav.settings],
] as const;

function Shell({ me }: { me: Me }) {
  async function logout() {
    const { redirect } = await api<{ redirect: string }>('/../auth/logout', { method: 'POST' });
    window.location.assign(redirect);
  }
  return (
    <div className="shell">
      <a className="skip-link" href="#main">
        {nl.nav.skip}
      </a>
      <header className="topbar">
        <span className="brand">
          SPARK<span>.</span>
        </span>
        <button
          className="btn btn--ghost"
          onClick={() => void logout()}
          style={{ color: '#faf6f1' }}
        >
          {nl.nav.logout}
        </button>
      </header>
      <nav className="nav" aria-label={nl.nav.main}>
        <span className="brand">
          SPARK<span style={{ color: 'var(--c-brand)' }}>.</span>
        </span>
        {NAV.map(([path, label]) => (
          <NavLink key={path} to={`/${path}`}>
            {label}
          </NavLink>
        ))}
      </nav>
      <main className="content" id="main" tabIndex={-1}>
        <p className="muted">Ingelogd als {me.user.name}</p>
        <Routes>
          {NAV.map(([path, label]) => (
            <Route key={path} path={`/${path}/*`} element={<Placeholder title={label} />} />
          ))}
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </main>
    </div>
  );
}

export function App() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  useEffect(() => {
    api<Me>('/me')
      .then((m) => {
        setCsrfToken(m.csrfToken);
        setMe(m);
      })
      .catch(() => setMe(null));
  }, []);

  if (me === undefined) {
    return (
      <p className="center-page" role="status">
        {nl.common.loading}
      </p>
    );
  }
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="*" element={me ? <Shell me={me} /> : <Navigate to="/login" replace />} />
    </Routes>
  );
}
