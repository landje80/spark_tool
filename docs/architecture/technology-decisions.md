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

Kritieke planning staat niet in het webproces. Een Scheduled Task roept `node dist/server/scripts/run-jobs.js` (of een beveiligd endpoint met `LEAD_GENERATION_CRON_SECRET`) aan; jobs staan in de `Job`-tabel met `dedupeKey`, retries en dead-letter.

## Open verificatie (vereist toegang tot server of externe accounts)

- Ondersteunde Node.js-versies in de Plesk Node.js-extensie op s1.gblict.nl.
- Of Passenger het `/tool`-prefix doorgeeft (healthcheck bevestigt).
- Beschikbaarheid van `ffmpeg` en de linux-`sharp`-binary.
- Anthropic: modelnaam en beschikbaarheid van web search voor het account.
- Postmark: webhook-authenticatie (Basic Auth/IP-allowlist) en inbound-configuratie.
