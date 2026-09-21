import { useEffect, useRef, useState } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { nl } from '../shared/i18n/nl';
import { BASE, api, logoutRequest, setCsrfToken, type Me } from './api';
import { AnnounceContext, fmt, usePageTitle } from './lib';
import { MeContext } from './me';
import { DashboardPage } from './pages/Dashboard';
import { ProspectDetailPage } from './pages/ProspectDetail';
import { NewProspectPage } from './pages/ProspectForm';
import { ProspectsPage } from './pages/Prospects';
import { TasksPage } from './pages/Tasks';

function LoginPage() {
  const denied = new URLSearchParams(useLocation().search).get('error') === 'denied';
  const returnTo = encodeURIComponent(`${BASE}/dashboard`);
  usePageTitle(nl.login.title);
  return (
    <main className="center-page" id="main">
      <div className="card login-card">
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
  usePageTitle(title);
  return (
    <>
      <h1>{title}</h1>
      <p className="muted">{nl.common.comingSoon}</p>
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
  const { pathname } = useLocation();
  const mainRef = useRef<HTMLElement>(null);
  const firstRender = useRef(true);
  const [announcement, setAnnouncement] = useState('');

  // Na een routewissel gaat de focus naar de inhoud (WCAG 2.4.3); niet bij de eerste weergave.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    mainRef.current?.focus();
  }, [pathname]);

  async function logout() {
    const { redirect } = await logoutRequest();
    window.location.assign(redirect);
  }

  return (
    <AnnounceContext.Provider
      value={(m) => {
        // Eerst leegmaken zodat dezelfde melding twee keer achter elkaar opnieuw wordt voorgelezen.
        setAnnouncement('');
        setTimeout(() => setAnnouncement(m), 50);
      }}
    >
      <div className="shell">
        <a className="skip-link" href="#main">
          {nl.nav.skip}
        </a>
        <header className="topbar">
          <span className="brand">
            SPARK<span>.</span>
          </span>
          <div className="topbar__actions">
            <NavLink to="/settings" className="topbar__link">
              {nl.nav.settings}
            </NavLink>
            <button className="btn btn--ghost topbar__btn" onClick={() => void logout()}>
              {nl.nav.logout}
            </button>
          </div>
        </header>
        <nav className="nav" aria-label={nl.nav.main}>
          <span className="brand">
            SPARK<span className="brand__dot">.</span>
          </span>
          {NAV.map(([path, label]) => (
            <NavLink
              key={path}
              to={`/${path}`}
              className={path === 'settings' ? 'nav__desktop-only' : undefined}
            >
              {label}
            </NavLink>
          ))}
        </nav>
        <main className="content" id="main" tabIndex={-1} ref={mainRef}>
          <p className="muted small">{fmt(nl.nav.signedInAs, { name: me.user.name })}</p>
          <Routes>
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/prospects" element={<ProspectsPage />} />
            <Route path="/prospects/new" element={<NewProspectPage />} />
            <Route path="/prospects/:id" element={<ProspectDetailPage />} />
            <Route path="/tasks" element={<TasksPage />} />
            <Route path="/customers/*" element={<Placeholder title={nl.nav.customers} />} />
            <Route path="/content/*" element={<Placeholder title={nl.nav.content} />} />
            <Route path="/settings/*" element={<Placeholder title={nl.nav.settings} />} />
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </main>
        <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
          {announcement}
        </div>
      </div>
    </AnnounceContext.Provider>
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
    <MeContext.Provider value={me}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="*" element={me ? <Shell me={me} /> : <Navigate to="/login" replace />} />
      </Routes>
    </MeContext.Provider>
  );
}
