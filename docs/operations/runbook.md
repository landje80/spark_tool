# Runbook

## Dagelijks

- Controleer dashboard: laatste succesvolle leadrun, mislukte jobs, integratiestatus (Fase D/E).
- `npm run healthcheck` (of monitor `GET /tool/health`).

## Eerste uitrol

1. Database en gebruiker aanmaken (zie deployment).
2. `npm run db:migrate` — voert `20260921000000_init` uit. **Deze migratie is nog niet tegen een echte MySQL getest**; draai hem eerst op een lege database en controleer met `npx prisma migrate status`.
3. `npm run db:seed` (rollen/permissies/instellingen; seed volgt in Fase C-afronding).
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

## Onderhoud

- `npm run audit:deps` wekelijks; dependency-upgrade via skill `dependency-upgrade`.
- Retentie: `PROSPECT_RETENTION_DAYS`, `AUDIT_LOG_RETENTION_DAYS` (retentiejob volgt).
