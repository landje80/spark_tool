# Runbook

## Dagelijks

- Controleer dashboard: laatste succesvolle leadrun, mislukte jobs, integratiestatus (Fase D/E).
- `npm run healthcheck` (of monitor `GET /tool/health`).

## Eerste uitrol

1. Database en gebruiker aanmaken (zie deployment).
2. `npm run db:migrate` — voert `20260921000000_init` uit (lokaal geverifieerd op MariaDB 11.8.2). Controleer daarna met `npx prisma migrate status`.
3. `npm run db:seed` (rollen, permissies en instellingen; geen persoonsgegevens).
4. Inloggen met de eerste toegestane gebruiker → wordt ADMIN.

## Back-up en herstel

- Dagelijks `mysqldump --single-transaction spark_tool | gzip` via Plesk Scheduled Task, buiten de webroot bewaren (`scripts/backup/db-backup.mjs`, nog te bouwen), bewaartermijn ≥14 dagen.
- Herstel: applicatie stoppen → `gunzip < backup.sql.gz | mysql spark_tool` → code op passende tag → starten.
- Test een herstel minimaal eenmaal vóór livegang.

## Incidenten

1. Identificeer `requestId` uit de foutmelding → zoek in logs.
2. Auth-problemen: controleer `auth.denied`-regels in `AuditLog` (`reason`).
3. Jobs: `Job.status = DEAD` → oorzaak in `lastError`, corrigeren, status terug naar `PENDING`.
4. Ongewenste e-mail: zet suppressie in `EmailSuppression`; controleer `EmailMessage`.
5. Vastgelopen verzonden e-mail (Instellingen toont "e-mail(s) niet volledig afgerond"): de mail is écht door Postmark bevestigd (`EmailMessage.status = QUEUED` met een `postmarkMessageId`... controleer eerst of die kolom leeg is — dan is de Postmark-aanroep zelf nooit bevestigd en is verder onderzoek nodig), maar de registratie (draft-status, prospectstatus, opvolgtaak) is na drie pogingen mislukt. Herstel handmatig: zet `OutreachDraft.status = 'SENT'`, `Prospect.status = 'EMAILED'` (als van toepassing) en maak zo nodig een opvolgtaak aan; zet daarna `EmailMessage.status = 'SENT'`. Zoek in de logs op `emailMessageId` voor de exacte oorzaak.

## Onderhoud

- `npm run audit:deps` wekelijks; dependency-upgrade via skill `dependency-upgrade`.
- Retentie: `PROSPECT_RETENTION_DAYS`, `AUDIT_LOG_RETENTION_DAYS` (retentiejob volgt).
