# Spark Tool

CRM, dagelijkse leadgeneratie (Anthropic), outreach (Postmark) en content intake voor Spark. Live op https://spark.nicenext.nl/tool (Plesk, Apache/Passenger, MySQL). Geen staging: `main` is productieklaar.

## Architectuur

Eén Node-app: Express 5 (API + statische SPA) + React/Vite onder basispad `/tool`. Prisma 6 + MySQL, server-side sessies in MySQL, Entra ID single-tenant (MSAL), Postmark, Anthropic. Taken via `Job`-tabel + Plesk Scheduled Task. Details: `docs/architecture/system-design.md`.

## Commando's

`npm run dev` · `verify` (format, lint, typecheck, prisma validate, test, build, audit) · `test` · `test:integration` · `build` · `db:migrate` · `db:backup` · `deploy:check` · `healthcheck`

## Conventies

- TypeScript strict; ESM met `.js`-extensies in server-imports.
- Gebruikersteksten uitsluitend in `src/shared/i18n/nl.ts`. Intern stabiele enums, extern Nederlandse labels.
- Validatie met Zod aan de rand; nooit ruwe request-body naar Prisma (mass assignment).
- Pure domeinlogica (normalisatie, dedupe, statusmachine) apart en getest.
- Kleine, logische commits (Conventional Commits). Niet wijzigen wat werkt zonder reden.

## Security (niet onderhandelbaar)

- Elke endpoint: `requirePermission(...)`; CSRF op niet-GET; frontendverberging is geen autorisatie.
- Secrets alleen in omgevingsvariabelen; nooit loggen, committen of tonen. `.env.example` bijwerken bij nieuwe variabelen.
- Mailen alleen na expliciete gebruikersactie, na suppressiecheck, met idempotencyKey. Geen automatische social-publicatie.
- Geen echte Postmark/Anthropic-aanroepen in tests.

## Definitie van klaar

`npm run verify` groen · relevante docs bijgewerkt · migratie beoordeeld op destructiviteit · reviewer-subagents bij substantiële wijzigingen · nooit "werkt" melden zonder uitgevoerde controle.

## Verboden

`rm -rf`, force-push, `prisma migrate reset`, `.env`/sleutels committen, live deploy bij falende checks, destructieve migratie zonder herstelroute (hooks blokkeren dit).

## Meer

`docs/` (requirements, architecture, security, deployment, runbook) · `.claude/rules/` (per gebied) · `.claude/skills/` (workflows) · `.claude/agents/` (reviewers)
