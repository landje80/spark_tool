# Technologiekeuzes en ADR's

Geverifieerd op **2026-09-21** tegen het npm-register en de installeerbare pakketten. Serverkant (Plesk op s1.gblict.nl) is **nog niet** geverifieerd; zie "Open verificatie".

## Versies

| Onderdeel                   | Keuze                  | Reden                                                                                          |
| --------------------------- | ---------------------- | ---------------------------------------------------------------------------------------------- |
| Node.js                     | 24 LTS lokaal (≥22.12) | Alle gekozen pakketten vereisen ≥20.19/22.12. Plesk-versie moet op de server worden bevestigd. |
| TypeScript                  | 6.0.3                  | typescript-eslint 8.70 ondersteunt `<6.1`. TS 7 valt buiten die range.                         |
| Express                     | 5.2.1                  | Async-fouten worden automatisch doorgegeven.                                                   |
| React / Vite / React Router | 19.3 / 8.3 / 7.18      | Actueel; Vite `base: '/tool/'`.                                                                |
| Prisma                      | **6.19.3** (ADR-001)   | Zie hieronder.                                                                                 |
| Zod                         | 4.6                    | Env-, input- en AI-outputvalidatie.                                                            |
| @azure/msal-node            | 6.0.1                  | Authorization code flow + PKCE, `getAuthCodeUrl`/`acquireTokenByCode` gecontroleerd.           |
| postmark                    | 5.1.0                  | Officiële Node.js SDK.                                                                         |
| @anthropic-ai/sdk           | 0.127.0                | Officiële SDK. Modelnaam via env, niet hardcoded.                                              |
| sharp                       | 0.35.4                 | Afbeeldingsverwerking (installatie op server controleren).                                     |
| multer                      | 2.4.0                  | Multipart-uploads (publieke uploadpagina); geheugenopslag, MIME wordt server-side gesniffed.   |
| Vitest                      | 5.0.1                  | Unit + integratie via `projects`.                                                              |

## ADR-001: Prisma 6.19 in plaats van 7.x

- **Context:** Prisma 7 vereist een driver-adapter voor MySQL (`@prisma/adapter-mariadb`). `npm audit` toonde daarbij 5 high-severity advisories in `mariadb`/`mysql2` zonder beschikbare fix (o.a. wachtwoordlek bij MitM, SQL-injectie bij bepaalde charsets).
- **Besluit:** Prisma 6.19.3 met de ingebouwde MySQL-engine. Geen `mariadb`/`mysql2` in de dependency tree.
- **Restrisico:** `deepmerge-ts` (in de Prisma CLI-config) heeft een stack-exhaustion-advisory (GHSA-ggr8-5vv4-36mx). Dit draait alleen tijdens build/migratie op eigen config, niet op gebruikersinvoer. Expliciet toegestaan in `scripts/verify/audit-deps.mjs`.
- **Heroverweging:** zodra Prisma 7 zonder kwetsbare driver beschikbaar is (dependency-upgrade skill).

## ADR-002: Eén Node.js-proces, Express + React SPA

Eén deploybare app onder `/tool`; Express serveert API en gebouwde SPA. Eenvoudig te hosten op Plesk. Alternatief (Next.js) is zwaarder voor Passenger en het subpad.

## ADR-003: Server-side sessies in MySQL

Eigen `PrismaSessionStore` (sessie-id in de database als SHA-256-hash). `express-mysql-session` is niet gekozen: het pint een oude `mysql2` met advisories. Cookie: `HttpOnly`, `Secure` (prod), `SameSite=Lax` (nodig voor de terugkeer van Microsoft), pad `/tool`, rolling 8 uur.

## ADR-004: Autorisatie via Entra-toewijzing + rollen in de database

Toegang tot de app vereist een expliciete `ENTRA_ALLOWED_USER_IDS`- of `ENTRA_ALLOWED_GROUP_IDS`-match (default deny). Rollen (ADMIN/MANAGER/SALES/CONTENT_EDITOR/VIEWER) staan in de database; nieuwe gebruikers krijgen `VIEWER`. Zolang er geen actieve ADMIN bestaat wordt de eerste toegestane gebruiker ADMIN (bootstrap). Groepen-overage (>200 groepen) wordt geweigerd tenzij de gebruiker via ID is toegestaan.

## ADR-005: Sub-URI `/tool` en Passenger

De app monteert al zijn routes onder `APP_BASE_PATH`. Omdat Passenger het prefix wel of niet kan afstrippen, normaliseert `app.ts` inkomende URL's. Zie `docs/deployment/plesk-deployment.md` voor de Apache-configuratie.

## ADR-006: Achtergrondtaken via jobs-tabel + Plesk Scheduled Task

Kritieke planning staat niet in het webproces. Een Scheduled Task roept `node dist/server/src/server/run-jobs.js` (`npm run jobs:run`) (of een beveiligd endpoint met `LEAD_GENERATION_CRON_SECRET`) aan; jobs staan in de `Job`-tabel met `dedupeKey`, retries en dead-letter.

## Open verificatie (vereist toegang tot server of externe accounts)

- Ondersteunde Node.js-versies in de Plesk Node.js-extensie op s1.gblict.nl.
- Of Passenger het `/tool`-prefix doorgeeft (healthcheck bevestigt).
- Beschikbaarheid van `ffmpeg` en de linux-`sharp`-binary.
- Anthropic: modelnaam en beschikbaarheid van web search voor het account.
- Postmark: webhook-authenticatie (Basic Auth/IP-allowlist) en inbound-configuratie.

## ADR-007: Leadonderzoek in twee fasen (web search, dan gestructureerde extractie)

- **Context:** Het model moet actuele webbronnen raadplegen (server-side `web_search`, `web_fetch`) en strikt gestructureerde kandidaten opleveren. De combinatie van `output_config.format` met web search (citaties in de resultaten) is door ons niet tegen de echte API geverifieerd, en we willen bronnen server-side kunnen controleren.
- **Besluit:** fase 1 = research met alleen zoek-/ophaaltools (streamend, `pause_turn`-hervatting, verbruik per beurt geboekt); fase 2 = extractie zonder tools via `messages.parse` + `zodOutputFormat`; daarna strikte Zod/regelvalidatie en bronverificatie tegen de werkelijk geziene URL's.
- **Gevolg:** twee aanroepen per run (iets duurder), maar robuust, testbaar met een mock en met een bewaard onderzoek dat een retry niet opnieuw laat betalen. Heroverweeg bij een modelupgrade of als de combinatie in één aanroep is bevestigd.
- **Modelnaam** blijft configuratie (`ANTHROPIC_MODEL_LEAD_RESEARCH`, geen default); prijzen staan in `cost.ts` en moeten bij een modelwissel worden gecontroleerd (skill `anthropic-prompt-change`).

## ADR-008: Eén jobrunner via Plesk Scheduled Task

Eén taak elke ~10 minuten (`npm run jobs:run`) plant idempotent de dagelijkse jobs in en verwerkt de wachtrij; geen `setInterval` in het webproces en geen aparte HTTP-cron-endpoint (dus `LEAD_GENERATION_CRON_SECRET` is in fase 1 ongebruikt). Build-uitvoer staat onder `dist/server/src/server/` (`rootDir` is de projectroot); `npm run verify` start de gebouwde server als smoke-test.

## ADR-009: Opslagpoort (`StoragePort`) met alleen een lokale implementatie, ffmpeg als los proces

- **Context:** Klantmateriaal (foto/video) moet ergens veilig staan, buiten de document root, met ruimte voor een toekomstige S3-compatibele backend zonder de rest van de app te raken. Videoverwerking vereist ffmpeg/ffprobe, die niet als npm-package meekomen (`fluent-ffmpeg` verpakt de binary zelf niet en voegt alleen een dunne wrapper toe).
- **Besluit:** een kleine `StoragePort`-interface (`put`/`get`/`getStream`/`delete`/`exists`) met één implementatie (`LocalStorage`, `UPLOAD_STORAGE_DRIVER=local`). ffmpeg/ffprobe worden direct via `node:child_process.spawn` aangeroepen (`FFMPEG_PATH`, leeg = PATH), met een timeout en een harde limiet op de hoeveelheid uitvoer; ontbreekt de binary, dan degradeert de pijplijn gracieus (geen thumbnail/metadata, geen crash).
- **Gevolg:** de mediapijplijn en de uploadroute weten niets van de opslag-backend; een S3-adapter is een nieuwe klasse achter dezelfde interface. `multer` gebruikt `diskStorage` (niet `memoryStorage()`): geüploade bestanden gaan naar een tijdelijk bestand op schijf, niet naar het procesgeheugen, zodat een groot of gelijktijdig bestand nooit tot geheugen-uitputting kan leiden (zie security-design.md). MIME-sniffing (magic bytes) en de type-specifieke groottecontrole gebeuren pas ná ontvangst, vóórdat er iets definitiefs naar de opslag of de database gaat.

## ADR-010: Bekende technische schuld (bewust uitgesteld, niet vergeten)

Uit de Fase I-codereview kwamen vier bevindingen die het waard zijn om te bouwen, maar waarvan de kosten (omvang van de wijziging, risico op regressie) niet opwogen tegen de waarde op dit moment. Vastgelegd hier zodat ze niet stilzwijgend blijven liggen; op te pakken bij de eerstvolgende gelegenheid dat het betrokken gebied toch wordt aangeraakt.

- **Twee aparte AI-writer-abstracties:** `outreach/writer.ts` (`DraftWriter`/`AiDraftWriter`/`TemplateDraftWriter`) en `publishing/writer.ts` (`ConceptWriter`/`AiConceptWriter`/`TemplateConceptWriter`) zijn structureel bijna identiek (zelfde patroon: een AI-implementatie via `AnthropicStructuredClient` + een sjabloon-implementatie voor de testomgeving) maar los van elkaar gebouwd in Fase E en Fase G. Samenvoegen tot één generieke abstractie zou de duplicatie wegnemen, maar raakt de contracttypes van beide modules; pas doen als een derde soortgelijke writer nodig is (dan pas is het patroon met zekerheid vast te stellen).
- **Gedupliceerde paginatiehelper:** de page/pageSize-berekening (skip/take, totale paginacount) komt in vergelijkbare vorm terug in meerdere `list*`-functies (`prospects/service.ts`, `customers/service.ts`, `content-intake`). Een gedeelde `paginate()`-helper in `shared/` zou dat centraliseren; uitgesteld omdat de huidige duplicatie klein en foutloos is, en de exacte vorm per module net iets verschilt (query-parameter-namen, default page size).
- **Frontend omzeilt de i18n-locale-resolver:** `shared/i18n/index.ts` heeft een `t()`/locale-resolver-mechanisme, maar alle frontendpagina's importeren `nl` rechtstreeks (`import { nl } from '../../shared/i18n/nl'`) in plaats van via `t()`. Werkt zolang er maar één taal is (Nederlands, bewust — zie product-requirements.md), maar betekent dat een toekomstige tweede taal een aanpassing in bijna elk frontendbestand vergt in plaats van alleen in de resolver. Bewust niet nu al "goed" gedaan: er is geen concrete tweede taal gepland, en het rechtstreeks importeren is eenvoudiger te lezen/debuggen zolang dat zo blijft.
- **Naamgeving `schemas.ts` vs. `schema.ts`:** de meeste modules gebruiken `schemas.ts` (meervoud) voor hun Zod-schema's (`content-intake`, `customers`, `prospects`); `lead-generation/schema.ts` en `publishing/schema.ts` gebruiken het enkelvoud, en `publishing` heeft zelfs allebei naast elkaar (`schema.ts` voor het AI-outputschema van conceptgeneratie, `schemas.ts` voor de HTTP-inputvalidatie) — ontstaan doordat die bestanden op verschillende momenten en met een net iets ander doel zijn toegevoegd. Cosmetisch, geen functioneel risico (de imports zijn overal expliciet en correct); opschonen naar één consistente naamgeving is een triviale maar brede diff (elke import van deze bestanden) die is uitgesteld tot een sowieso al brede wijziging in die modules.
- **Heroverweging:** zodra een S3-compatibele bucket beschikbaar is voor klantmateriaal (buiten de scope van fase 1).
