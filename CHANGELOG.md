# Changelog

## [Unreleased]

### Changed

- App draait voortaan op een eigen subdomein (`tool.nicenext.nl`) in plaats van onder `/tool` op het gedeelde `spark.nicenext.nl`: `APP_BASE_PATH` en Vite's `base` staan standaard op root (`/`); Document Root wijst direct naar `dist/web` (zie ADR-005 in `docs/architecture/technology-decisions.md`).
- `prisma generate` loopt voortaan ook via een eigen `postinstall`-script, naast `@prisma/client`'s eigen hook.
- `pino`-logger ondersteunt een optionele `LOG_FILE` naast stdout, voor hosting waar Apache/Passenger-stdout-opvang onbetrouwbaar bleek.
- Frontendtooling teruggezet naar Vite 5 + `@vitejs/plugin-react` 4 (Vitest 3): Vite 5 ondersteunt Node 21 (de hoogste versie op Plesk), waardoor de frontend in principe ook op de server kan worden gebouwd; `engines` is `^18 || >=20`. Vitest 3 vraagt `fileParallelism: false` op root-niveau van `vitest.config.ts` (integratietests delen één database).
- `.npmrc` met `scripts-prepend-node-path` verwijderd: onbekende optie in huidige npm en bewezen zonder effect op het Prisma-`postinstall`-probleem (zie `docs/deployment/plesk-deployment.md` §2/§7).

### Fixed

- Passenger-opstartbestand is nu `passenger-start.cjs` (laadt de app via `import()`). Passenger's node-loader gebruikt `require(startupFile)`, wat voor een ES-module (`"type": "module"`) op Node < 22.12 faalt met ERR_REQUIRE_ESM: de app startte op Plesk (Node 21.7.3) nooit, zonder enige logregel. Dit was de hoofdoorzaak van de 500's na de eerste uitrol. De smoke-test start de gebouwde server nu via ditzelfde bestand.
- `npm run build:web` bouwt nu altijd een productiebuild (`scripts/build/build-web.mjs` dwingt `NODE_ENV=production` af). Eerder erfde `vite build` een niet-productie `NODE_ENV` uit de lokale `.env` (via `npm run verify`), waardoor `dist/web` de ontwikkelversie van React bevatte (~668 kB i.p.v. ~348 kB).

## [0.1.0] — 2026-09-22

Fase 1 (Fasen C–I) van het masterplan: CRM, dagelijkse leadgeneratie, outreach en klanten/content/media/review zijn gebouwd en getest. Fase H (daadwerkelijke uitrol naar Plesk) staat klaar maar is nog niet uitgevoerd — wacht op echte secrets/serverdata (Entra, Postmark, Anthropic, Plesk-toegang); zie `docs/deployment/plesk-deployment.md`.

### Added

- **Fundament (C):** Express 5 + React/Vite onder `/tool`, Prisma-schema (MySQL) en migraties; Microsoft Entra ID SSO (single-tenant, PKCE, default-deny allowlist), server-side sessies (eigen `PrismaSessionStore`), CSRF, RBAC-permissies per rol; responsive shell.
- **CRM (D):** prospects met normalisatie/deduplicatie/statusmachine, bronnen, sociale profielen, activiteiten, taken, filters/zoeken/sorteren/paginering, bulkacties, CSV-export, samenvoegen, archiveren/anonimiseren, dashboard (KPI's, funnel).
- **Leadgeneratie (E):** dagelijkse run via Anthropic (web search + gestructureerde extractie), strikt Zod-schema, dedupe tegen het CRM, reviewqueue voor twijfelgevallen, dagbudget met kostentracking, idempotente/hervatbare runs via de jobs-tabel (nog niet gedraaid met een echte API-sleutel).
- **Outreach (F):** conceptmail → bewerken → preview → expliciete bevestiging → Postmark; suppressielijst, idempotente verzending, webhookverwerking (delivery/bounce/spam/open/click/inbound) atomair per event.
- **Klanten/content/media/review (G):** prospect → Customer-omzetting, geversioneerde BrandProfiles; tijdelijke uploadlinks (gehasht token) en mobiele uploadpagina voor eindklanten; mediapijplijn (sharp voor afbeeldingen, ffmpeg/ffprobe voor video, gracieuze degradatie zonder die binaries); AI-conceptteksten per platform met menselijke review vóór goedkeuring; `PublisherAdapter` bewust als handmatige registratie (geen automatische publicatie).
- **Fase I:** volledige codereview (architectuur, security, database, toegankelijkheid, deployment, tests) over de hele codebase; bevindingen verwerkt — zie onderstaande Fixed/Changed-secties en `docs/architecture/technology-decisions.md` (ADR-010) voor de bewust uitgestelde rest.

### Fixed

- Vite dev-proxy stuurde het eigen frontendbestand `src/web/api.ts` (op `/tool/api.ts`) abusievelijk naar de backend door een ontbrekende trailing slash in de proxysleutel.
- `processMediaAsset` had een niet-atomaire idempotentiecheck; twee gelijktijdige aanroepen op dezelfde asset konden dubbele afgeleiden proberen aan te maken. Nu een named lock per asset-id om de hele check-en-verwerk-stap heen.
- `publishing/review.ts`: een named-lock-race tussen twee gelijktijdige reviewacties op dezelfde conceptpost/submission kon een rauwe databasefout (in plaats van een nette 409) naar boven laten komen; nu opgevangen en genormaliseerd.
- `content-intake/brand.ts`: `activateBrandProfile` miste de named lock die `createBrandProfileVersion` al had, met een risico op twee tegelijk actieve merkprofielversies.
- `prospects/bulk.ts`: `mergeProspects` gebruikte nog niet dezelfde `PROSPECT_WRITE_LOCK` als de andere identiteitsschrijvende paden.
- Diverse toegankelijkheidsbevindingen: ontbrekende hoorbare feedback en foutafhandeling op verschillende formulieren/acties, focusverlies na het verwijderen van een lijstitem, dubbele aankondigingen, ontbrekende statuskleurcodering.

### Changed

- Globaal `BigInt.prototype.toJSON`-vangnet (verdediging in de diepte naast de bestaande, bewuste per-query uitsluiting van `MediaAsset.sizeBytes`).
- `/tool/health` doet nu een echte databasecheck in plaats van een statisch antwoord.
- Documentatie (README, productvereisten, environment-variables, ADR's) gesynchroniseerd met de daadwerkelijke buildstatus.
