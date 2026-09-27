# Plesk-deployment (spark.nicenext.nl/tool)

> Niet uitgevoerd: er is geen toegang tot s1.gblict.nl vanuit de ontwikkelomgeving. Stappen zijn afgeleid uit Plesk/Passenger-documentatie en moeten bij eerste uitrol worden geverifieerd (healthcheck).

## Node-versie: bouwen lokaal, draaien op Plesk

Plesk op s1.gblict.nl biedt Node.js tot en met **21.7.3**; deze app vereist **≥22.12** (`package.json` `engines`). Dat komt uitsluitend door **Vite** (de frontend-bundler, `engines.node: "^20.19.0 || >=22.12.0"`) — Express, Prisma en de gecompileerde servercode zelf hebben niets hogers nodig dan Node 18.

Oplossing: `dist/web/` (de gebouwde frontend) wordt **lokaal** gebouwd en meegecommit in Git, in plaats van op de server. `dist/server/` (de gecompileerde backend, via `tsc`) blijft wél op de server gebouwd — TypeScript's compiler zelf vereist maar Node ≥14.17.

**Bij elke release, vóór je tagt/pusht:**

```bash
npm run build:web        # bouwt dist/web/ lokaal (hier is Node 22+ beschikbaar)
git add dist/web
git commit -m "build: dist/web voor release"
```

`dist/web/` staat om deze reden expliciet **niet** in `.gitignore` (met uitleg in het bestand zelf), in afwijking van de normale regel dat build-output niet in Git hoort.

De deploy-acties in Plesk (§2 hieronder) draaien daarom **npm run build:server** in plaats van **npm run build**, en **niet** `npm run verify` (die roept intern `vite build` aan, wat op Node 21.7.3 faalt) — `npm run verify` blijft een lokale/pre-push stap, zoals die al voor elke commit in dit project wordt gebruikt.

## 1. Voorbereiding (eigenaar)

1. **DNS:** A/AAAA-record `spark.nicenext.nl` → IP van s1.gblict.nl (bestaat mogelijk al voor de publieke site — niet wijzigen).
2. **SSL:** Let's Encrypt-certificaat voor `spark.nicenext.nl` in Plesk (Websites & Domains → SSL/TLS), HTTPS-redirect aan.
3. **MySQL:** database `spark_tool`, gebruiker `spark_app` met rechten `SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, REFERENCES, DROP` alleen op deze database (DROP/ALTER nodig voor migraties; zie runbook voor een aparte migratiegebruiker als je least privilege wilt aanscherpen).
4. **Entra:** app-registratie (single-tenant) met redirect `https://spark.nicenext.nl/tool/auth/callback`; client secret; optionele `groups` claim.
5. **Postmark:** server-token, verified sender, webhook-URLs `https://spark:<WEBHOOK_SECRET>@spark.nicenext.nl/tool/api/webhooks/postmark` (Fase F).

## 2. Applicatie

1. Plesk → Git → repository toevoegen (GitHub, SSH deploy key), branch `main`, deploymentpad `/var/www/vhosts/nicenext.nl/spark-tool` (**buiten** de document root).
2. Plesk → Node.js: hoogst beschikbare versie (21.7.3 op dit moment — zie "Node-versie" hierboven voor waarom dat oké is), Application mode `production`, Application root = deploymentpad, Startup file `dist/server/src/server/index.js`. Zet de omgevingsvariabelen uit `.env.example` (geheimen alleen hier).
3. Actions na deploy (Git → Additional deployment actions):
   ```
   npm ci
   npm run deploy:check
   npm run db:backup
   npm run db:migrate
   npm run build:server
   ```
   Daarna "Restart App". (Geen `npm run verify` en geen `npm run build:web`/`npm run build` hier — zie "Node-versie" hierboven; `dist/web/` komt al gebouwd mee via Git.)
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

Kritieke planning staat bewust **niet** in het webproces. Maak in Plesk (Tools & Settings of per domein → Scheduled Tasks) twee taken, uitgevoerd als de gebruiker van de app, met de applicatiemap als werkmap:

| Taak             | Schema          | Commando                                                                                                                    | Doel                                                                                                                                                                                                                                                      |
| ---------------- | --------------- | --------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Jobrunner        | elke 10 minuten | `cd /var/www/vhosts/nicenext.nl/spark-tool && /usr/bin/env node dist/server/src/server/run-jobs.js` (of `npm run jobs:run`) | Plant de dagelijkse jobs idempotent in (leadrun pas na 06:30 lokale tijd, alleen als ingeschakeld en geconfigureerd; onderhoud) en verwerkt de wachtrij, inclusief handmatige runs uit de UI. Exitcode 2 = er zijn jobs definitief mislukt (dead-letter). |
| Database-back-up | dagelijks 02:00 | `npm run db:backup`                                                                                                         | mysqldump buiten de webroot (zie runbook).                                                                                                                                                                                                                |

Gebruik het Node.js-pad dat bij de gekozen Plesk-Node-versie hoort (Plesk → Node.js toont het pad). De jobrunner leest dezelfde omgevingsvariabelen als de app; in Plesk-taken moeten die daarom ook beschikbaar zijn (exporteer ze in het taakcommando of gebruik een `.env` buiten Git met minimale rechten).

## 5. Logs

Plesk → Node.js → Logs, en `/var/www/vhosts/nicenext.nl/logs/`. Applicatielogs zijn JSON (pino) zonder secrets.

## 6. Rollback

1. `git tag` bij elke release (`v0.x.y`).
2. Code: in Plesk Git de vorige tag/commit deployen (`git checkout <tag>`), `npm ci`, `npm run build:server` (die tag heeft zijn eigen `dist/web/` al meegecommit), restart.
3. Database: migraties zijn expand/contract; controleer vóór rollback of het oude schema compatibel is. Anders herstel de back-up van vóór de migratie (`docs/operations/runbook.md`).
