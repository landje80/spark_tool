# Plesk-deployment (spark.nicenext.nl/tool)

> Niet uitgevoerd: er is geen toegang tot s1.gblict.nl vanuit de ontwikkelomgeving. Stappen zijn afgeleid uit Plesk/Passenger-documentatie en moeten bij eerste uitrol worden geverifieerd (healthcheck).

## 1. Voorbereiding (eigenaar)

1. **DNS:** A/AAAA-record `spark.nicenext.nl` → IP van s1.gblict.nl (bestaat mogelijk al voor de publieke site — niet wijzigen).
2. **SSL:** Let's Encrypt-certificaat voor `spark.nicenext.nl` in Plesk (Websites & Domains → SSL/TLS), HTTPS-redirect aan.
3. **MySQL:** database `spark_tool`, gebruiker `spark_app` met rechten `SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, REFERENCES, DROP` alleen op deze database (DROP/ALTER nodig voor migraties; zie runbook voor een aparte migratiegebruiker als je least privilege wilt aanscherpen).
4. **Entra:** app-registratie (single-tenant) met redirect `https://spark.nicenext.nl/tool/auth/callback`; client secret; optionele `groups` claim.
5. **Postmark:** server-token, verified sender, webhook-URLs `https://spark:<WEBHOOK_SECRET>@spark.nicenext.nl/tool/api/webhooks/postmark` (Fase F).

## 2. Applicatie

1. Plesk → Git → repository toevoegen (GitHub, SSH deploy key), branch `main`, deploymentpad `/var/www/vhosts/nicenext.nl/spark-tool` (**buiten** de document root).
2. Plesk → Node.js: Node-versie ≥22.12 (LTS), Application mode `production`, Application root = deploymentpad, Startup file `dist/server/server/index.js`. Zet de omgevingsvariabelen uit `.env.example` (geheimen alleen hier).
3. Actions na deploy (Git → Additional deployment actions):
   ```
   npm ci
   npm run deploy:check
   npm run verify
   npm run db:backup
   npm run db:migrate
   npm run build
   ```
   Daarna "Restart App".
4. `npm run healthcheck` moet slagen.

## 3. Subpad `/tool` — Apache/Passenger

De publieke site op `spark.nicenext.nl` moet ongemoeid blijven. Voeg toe onder Apache & nginx → _Additional directives for HTTPS_ (en HTTP):

```apache
PassengerBaseURI /tool
```

plus een `PassengerAppRoot`/`PassengerStartupFile`-configuratie voor deze app (of, als de Plesk Node.js-extensie een eigen Application URL toestaat, stel die in op `/tool`). Maak zo nodig in de document root een symlink `tool → <app>/dist/web` zodat Passenger het subpad herkent.

**Fallback:** Node-app op een aparte (interne) Plesk-domeinnaam en in de site-config:

```apache
ProxyPass        /tool https://<interne-host>/tool
ProxyPassReverse /tool https://<interne-host>/tool
```

De app werkt met of zonder afgestript prefix (`src/server/app.ts`). Verifieer met `GET /tool/health` → `{"status":"ok"}`.

## 4. Scheduled Tasks

- Dagelijks 06:30 (Europe/Amsterdam): job-runner voor leadgeneratie (Fase E), met `LEAD_GENERATION_CRON_SECRET`.
- Elk uur: jobs opruimen/retry, verlopen sessies en uploadtokens purgen.
- Dagelijks 02:00: `npm run db:backup`.

## 5. Logs

Plesk → Node.js → Logs, en `/var/www/vhosts/nicenext.nl/logs/`. Applicatielogs zijn JSON (pino) zonder secrets.

## 6. Rollback

1. `git tag` bij elke release (`v0.x.y`).
2. Code: in Plesk Git de vorige tag/commit deployen (`git checkout <tag>`), `npm ci`, `npm run build`, restart.
3. Database: migraties zijn expand/contract; controleer vóór rollback of het oude schema compatibel is. Anders herstel de back-up van vóór de migratie (`docs/operations/runbook.md`).
