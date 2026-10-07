# Changelog

## [Unreleased]

### Changed

- Leadonderzoek gebruikt automatische prompt caching (`cache_control` op het verzoek): bij de eerste echte runs bestond ~85% van de kosten (≈$1,30 van $1,53) uit invoertokens, omdat elke hervatting/zoekronde de hele groeiende context (zoekresultaten) opnieuw tegen volle prijs meestuurde. Of dit ook binnen één serverlus werkt, blijkt uit de nieuwe cachekolom bij een run.
- Leadonderzoek haalt de Spark-site niet meer op (`web_fetch` verwijderd): `spark.nicenext.nl` is een doorverwijzing en de ophaalactie faalde, wat zoekbudget kostte; de run van 7 okt leverde daardoor 0 kandidaten ("Server tool use limit exceeded"). Het model hoort nu hoeveel zoekopdrachten het heeft en moet kandidaten per zoekopdracht combineren; één openbaar socialmediaprofiel per kandidaat volstaat voor het onderzoek (de validatie blijft ongewijzigd). Het app-log schrijft per onderzoeksbeurt de ruwe tokentelling.
- Instellingen → Recente runs toont per run hoeveel kandidaten het model voorstelde, welke bij de controle werden afgewezen (met reden), de stopreden, een notitie van het model en de cachetokens. Eerder was een run met "0 toegevoegd" niet te onderscheiden van "niets gevonden" of "alles afgewezen".

## [0.2.0] — 2026-10-05

Eerste versie die daadwerkelijk op de server draait (Fase H): `https://tool.nicenext.nl` op Plesk (s1.gblict.nl) met Apache/Passenger, Node 21.7.3, inloggen via Entra, een werkende Postmark-webhook (alle zes events geverifieerd) en een jobrunner die elke 10 minuten via een Plesk-taak wordt aangeroepen. De uitrol legde een reeks serverspecifieke valkuilen bloot; die staan in `docs/deployment/plesk-deployment.md` (§2, §3, §7).

### Changed

- App draait voortaan op een eigen subdomein (`tool.nicenext.nl`) in plaats van onder `/tool` op het gedeelde `spark.nicenext.nl`: `APP_BASE_PATH` en Vite's `base` staan standaard op root (`/`); Document Root wijst direct naar `dist/web` (zie ADR-005 in `docs/architecture/technology-decisions.md`).
- `prisma generate` loopt voortaan ook via een eigen `postinstall`-script, naast `@prisma/client`'s eigen hook.
- `pino`-logger ondersteunt een optionele `LOG_FILE` naast stdout, voor hosting waar Apache/Passenger-stdout-opvang onbetrouwbaar bleek.
- Frontendtooling teruggezet naar Vite 5 + `@vitejs/plugin-react` 4 (Vitest 3): Vite 5 ondersteunt Node 21 (de hoogste versie op Plesk), waardoor de frontend in principe ook op de server kan worden gebouwd; `engines` is `^18 || >=20`. Vitest 3 vraagt `fileParallelism: false` op root-niveau van `vitest.config.ts` (integratietests delen één database).
- Nieuwe HTTP-trigger `GET|POST /internal/run-jobs` (Basic Auth, gebruiker `cron`, wachtwoord `LEAD_GENERATION_CRON_SECRET`) die dezelfde ronde draait als `npm run jobs:run` (nu via `runJobsOnce`). Nodig omdat cron-taken op s1.gblict.nl in een chroot-shell draaien waar Plesk's Node onbereikbaar is; een Plesk-taak "URL ophalen" werkt op elke installatie. `LEAD_GENERATION_CRON_SECRET` is daarmee niet langer gereserveerd; een lege waarde in `.env` blokkeert het opstarten niet meer.
- `.npmrc` met `scripts-prepend-node-path` verwijderd: onbekende optie in huidige npm en bewezen zonder effect op het Prisma-`postinstall`-probleem (zie `docs/deployment/plesk-deployment.md` §2/§7).

### Fixed

- Postmark-webhook gaf een 500 ("Not Verified") op het Bounce-testevent: `addSuppression` gebruikte `upsert`, wat in Prisma een select-dan-insert is. Twee gelijktijdige events voor hetzelfde adres (Postmark vuurt bij het opslaan van een webhook alle testevents tegelijk af; in productie kunnen een bounce en een spamklacht samenvallen) gaven een unique-fout op `EmailSuppression.emailHash`. Nu één atomaire `INSERT IGNORE` (`createMany` + `skipDuplicates`), voor alle aanroepers (webhooks, afmeldpagina, handmatig, verzendfout). Regressietest in `suppression-race.integration.test.ts` (faalt op de oude code). Webhookfouten loggen nu ook de Prisma-foutcode (`WebhookEvent.error` en app-log), niet alleen de klassenaam.
- Inloggen via Entra faalde met `nonce_mismatch`: msal-node weigert elk ID-token met een nonce als de verwachte nonce niet in het `acquireTokenByCode`-verzoek zit. `EntraClient.complete()` krijgt de nonce uit de sessie nu mee. De integratietests mocken `EntraClient`, daarom is er een eigen unit-test (`entra.test.ts`) die het echte verzoek aan MSAL controleert.
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
