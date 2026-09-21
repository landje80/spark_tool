# Systeemontwerp

## Overzicht

```
Browser ── https://spark.nicenext.nl/tool ──> Apache (Plesk) ──> Passenger ──> Node/Express
                                                                  │
                          React SPA (dist/web) <──────────────────┤
                          /tool/api/*  (JSON, sessie + CSRF)      │
                          /tool/auth/* (Entra OIDC)               ├── MySQL (Prisma)
                          /tool/health                            ├── Postmark (uitgaand + webhooks)
                                                                  ├── Anthropic (leadgeneratie, content)
                          Plesk Scheduled Task ──> job runner ────┴── private opslag (buiten docroot)
```

## Modules (`src/`)

- `config/` — Zod-gevalideerde omgeving (`env.ts`); faalt snel zonder secrets te tonen.
- `server/` — Express-app, security-headers, sessies, routing onder het basispad.
- `modules/auth` — `access.ts` (toegangsbeslissing, puur en getest), sessiestore, middleware (`requirePermission`, CSRF), routes.
- `modules/prospects` — normalisatie, deduplicatie, statusmachine (puur en getest). API/services volgen in Fase D.
- `modules/audit` — `audit()` schrijft naar `AuditLog`.
- `integrations/microsoft` — `EntraClient` (MSAL Node).
- `shared/` — database, security (permissies, tokens), logging (pino met redactie), errors, i18n (`nl.ts`).
- `web/` — React-app, mobile-first, NiceNext-huisstijl, teksten uit `shared/i18n`.

Geplande modules (Fase D–G): lead-generation, outreach, customers, content-intake, media-processing, publishing, jobs.

## Routing onder `/tool`

- Vite `base: '/tool/'`; React Router `basename` uit `import.meta.env.BASE_URL`.
- Express monteert alles op `APP_BASE_PATH`; cookiepad `/tool`.
- API-fouten hebben een stabiele `code` en `requestId`; nooit stacktraces.
- SPA-fallback geldt voor alle GET's behalve `/api/*` en `/auth/*`.

## Authenticatiestroom

1. `GET /tool/auth/login` → state, nonce, PKCE-verifier in de sessie → redirect naar Entra (tenant-specifieke authority).
2. `GET /tool/auth/callback` → state (constant-time) → code-exchange → `evaluateAccess` (tid, aud, iss, nonce, allowlist) → gebruiker upserten → **sessie roteren** → CSRF-token.
3. `POST /tool/auth/logout` (CSRF) → sessie vernietigen → redirect naar Entra logout.

Entra-app-registratie: redirect-URI `https://spark.nicenext.nl/tool/auth/callback`, logout-URI `https://spark.nicenext.nl/tool/login`, single-tenant, optionele `groups` claim (groepen-toewijzing) of directe gebruikerstoewijzing.

## Autorisatie

`requirePermission('x.y')` op elk endpoint; permissies per rol in `shared/security/permissions.ts` (geseed in `RolePermission`). De frontend verbergt alleen; de server beslist.

## Achtergrondtaken

`Job`-tabel met `dedupeKey` (idempotent inplannen), `attempts`/`maxAttempts`, exponentiële backoff, `DEAD`-status. Uitvoering via Plesk Scheduled Task.

## Status

| Fase | Onderdeel                    | Status                                                                                                                                                                                                                                                            |
| ---- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C    | Fundament, auth, shell       | Gebouwd, getest                                                                                                                                                                                                                                                   |
| D    | CRM (API + schermen)         | Gebouwd; 48 integratietests op MariaDB; UI handmatig gecontroleerd (desktop + mobiel); security-, database- en accessibility-review verwerkt (zie security-design.md voor bewust geaccepteerde punten). Nog niet: klant-conversie (Fase G), outreach-tab (Fase F) |
| E    | Leadgeneratie                | **Nog te bouwen**                                                                                                                                                                                                                                                 |
| F    | Outreach + webhooks          | **Nog te bouwen**                                                                                                                                                                                                                                                 |
| G    | Content/uploads/media/review | **Nog te bouwen**                                                                                                                                                                                                                                                 |
| H    | Deployment-scripts           | Deels                                                                                                                                                                                                                                                             |
