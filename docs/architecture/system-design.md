# Systeemontwerp

## Overzicht

```
Browser ── https://spark.nicenext.nl/tool ──> Apache (Plesk) ──> Passenger ──> Node/Express
                                                                  │
                          React SPA (dist/web) <──────────────────┤
                          /tool/api/*  (JSON, sessie + CSRF)      │
                          /tool/auth/* (Entra OIDC)               ├── MySQL (Prisma)
                          /tool/upload/:token (publiek, klant)    ├── Postmark (uitgaand + webhooks)
                          /tool/unsubscribe/:token (publiek)      ├── Anthropic (leadgeneratie, content)
                          /tool/webhooks/postmark (publiek)       │
                          /tool/health                            │
                                                                  │
                          Plesk Scheduled Task ──> job runner ────┴── private opslag (buiten docroot)
```

## Modules (`src/`)

- `config/` — Zod-gevalideerde omgeving (`env.ts`); faalt snel zonder secrets te tonen.
- `server/` — Express-app, security-headers, sessies, routing onder het basispad.
- `modules/auth` — `access.ts` (toegangsbeslissing, puur en getest), sessiestore, middleware (`requirePermission`/`requireAnyPermission`, CSRF), routes.
- `modules/prospects` — normalisatie, deduplicatie, statusmachine, CRM-API en -schermen.
- `modules/lead-generation` — tweefasen leadonderzoek (web search + extractie), reviewqueue.
- `modules/outreach` — conceptmails, verzenden (Postmark), webhooks, suppressie.
- `modules/customers` — klantbeheer, prospect→klant-conversie.
- `modules/content-intake` — merkprofiel, uploadlinks (publieke uploadpagina), submission-intake.
- `modules/media-processing` — sharp/ffmpeg-pijplijn met gracieuze degradatie.
- `modules/publishing` — AI-conceptgeneratie, reviewworkflow per platform, publisher-adapter (fase 1: uitgeschakeld).
- `modules/jobs` — jobwachtrij (`Job`-tabel), runner, geplande dagelijkse taken.
- `modules/audit` — `audit()` schrijft naar `AuditLog`.
- `integrations/microsoft` — `EntraClient` (MSAL Node); `integrations/postmark`, `integrations/anthropic`, `integrations/storage` — vervangbare poorten naar externe diensten/opslag.
- `shared/` — database (client, named locks, sessiestore, prompt-versies), security (permissies, tokens), logging (pino met redactie), errors, i18n (`nl.ts`), http (gedeelde publieke-paginaopmaak).
- `web/` — React-app, mobile-first, NiceNext-huisstijl, teksten uit `shared/i18n`.

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

| Fase | Onderdeel                    | Status                                                                                                                                                                                                                                                         |
| ---- | ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C    | Fundament, auth, shell       | Gebouwd, getest                                                                                                                                                                                                                                                |
| D    | CRM (API + schermen)         | Gebouwd, getest (integratietests op MariaDB); UI handmatig gecontroleerd (desktop + mobiel); security-, database- en accessibility-review verwerkt (zie security-design.md voor bewust geaccepteerde punten)                                                   |
| E    | Leadgeneratie                | Gebouwd en getest met een mock. **Nog niet met een echte API-sleutel gedraaid** (zie lead-generation.md)                                                                                                                                                       |
| F    | Outreach + webhooks          | Gebouwd en getest (zie outreach.md)                                                                                                                                                                                                                            |
| G    | Klanten/content/media/review | Gebouwd en getest (sjabloon-schrijver in tests, geen echte AI-aanroep); mediapijplijn getest met echte sharp-verwerking; ffmpeg-pad degradeert gracieus zonder de binary (zie content-and-publishing.md). Automatisch publiceren naar sociale media blijft uit |
| H    | Deployment-scripts           | Deels                                                                                                                                                                                                                                                          |
