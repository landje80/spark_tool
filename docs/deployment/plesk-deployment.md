# Plesk-deployment (tool.nicenext.nl)

De app draait op een eigen subdomein (`tool.nicenext.nl`), zonder gedeeld subpad — dit vermijdt
een hele categorie problemen (asset-paden, Document Root die niet overeenkomt met de build-output,
`PassengerBaseURI`-constructies) die bij een gedeeld domein met subpad wél speelden. Draait de app
ooit alsnog onder een subpad van een ander domein, zie de git-geschiedenis van dit bestand voor de
oude `/tool`-aanpak, en zet `APP_BASE_PATH` (`src/config/env.ts`) en `base` (`vite.config.ts`) naar
dat subpad.

## Node-versie

Plesk op s1.gblict.nl biedt Node.js tot en met **21.7.3**. De app gebruikt daarom **Vite 5** (`engines.node: "^18.0.0 || >=20.0.0"`, dus inclusief Node 21) met `@vitejs/plugin-react` 4. Vite 6+ sluit Node 21 formeel uit en Vite 8 (rolldown) vereist ≥22.12. `engines` in `package.json` is daarop afgestemd (`^18 || >=20`). Vitest (alleen dev/CI, draait nooit op Plesk) staat op 3.x: die versie werkt met Vite 5 en kent al de `projects`-configuratie.

`dist/web/` (de gebouwde frontend) wordt voorlopig **nog steeds meegecommit** in Git, als vangnet: dat Vite 5 bouwt op Node 24 is lokaal bewezen, maar nog niet op Plesk's Node 21.7.3 zelf. Controleer dat één keer via SSH (`npm run build:web`, met de `PATH` uit §2). Lukt dat, dan kan `dist/web/` uit Git (terug in `.gitignore`) en draait de deploy `npm run build` in plaats van `build:server`.

**Bij elke release, vóór je tagt/pusht** (zolang `dist/web/` in Git staat):

```bash
npm run build:web        # bouwt dist/web/ als productiebuild
git add dist/web
git commit -m "build: dist/web voor release"
```

`npm run build:web` gaat via `scripts/build/build-web.mjs` en forceert `NODE_ENV=production`. `vite build` erft anders `NODE_ENV` uit de omgeving, en een lokale `.env` met `NODE_ENV=development` (die `npm run verify` injecteert) leverde eerder een `dist/web` met de ontwikkelversie van React op (~668 kB i.p.v. ~348 kB).

De deploy-acties in Plesk (§2 hieronder) draaien tot die controle `npm run build:server`; `npm run verify` blijft een lokale/pre-push stap (draait o.a. alle integratietests tegen een lokale testdatabase).

## 1. Voorbereiding (eigenaar)

1. **DNS/subdomein:** Plesk → Websites & Domeinen → subdomein `tool` toevoegen onder `nicenext.nl` → `tool.nicenext.nl`. Als Plesk de DNS-zone van `nicenext.nl` beheert, wordt het A-record automatisch aangemaakt.
2. **SSL:** Let's Encrypt-certificaat voor `tool.nicenext.nl` (en desgewenst `www.tool.nicenext.nl`) in Plesk (Websites & Domains → SSL/TLS), HTTPS-redirect aan.
3. **MySQL:** database `spark_tool`, gebruiker `spark_app` met rechten `SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, REFERENCES, DROP` alleen op deze database (DROP/ALTER nodig voor migraties; zie runbook voor een aparte migratiegebruiker als je least privilege wilt aanscherpen).
4. **Entra:** app-registratie (single-tenant) met redirect `https://tool.nicenext.nl/auth/callback`; client secret; optionele `groups` claim.
5. **Postmark:** server-token, verified sender, webhook-URL `https://postmark:<POSTMARK_WEBHOOK_SECRET>@tool.nicenext.nl/webhooks/postmark` (Fase F; de gebruikersnaam moet exact `postmark` zijn, `public-routes.ts` weigert elke andere met 401; gebruik bij voorkeur een geheim met alleen letters en cijfers, zodat het niet hoeft te worden ge-escaped) op de "Default Transactional Stream" (Postmark's interne ID daarvoor is `outbound`, ook al toont de UI "Default Transactional Stream").

## 2. Applicatie

1. Plesk → `tool.nicenext.nl` → Git → repository toevoegen (GitHub), branch `main`, "Zoekpad server" = `/tool.nicenext.nl/tool` (dus een submap `tool` binnen de vhost — **buiten** de document root).
2. Plesk → Node.js: hoogst beschikbare versie (21.7.3 op dit moment — zie "Node-versie" hierboven voor waarom dat oké is), Application mode `production`, Application root = het pad uit stap 1, Document root = `.../tool/dist/web` (de gebouwde frontend zelf — **niet** een losse `public/`-map; zie "Document Root" hieronder), Startup file **`passenger-start.cjs`** (niet `dist/server/src/server/index.js`: zie §7). Zet de omgevingsvariabelen uit `.env.example` (geheimen alleen hier).
3. **Laat het Git-paneel's "Aanvullende acties bij publicatie" leeg.** Op deze server draait dat in een beperkte/afgeschermde shell zonder bruikbare `PATH` (zelfs `whoami` en absolute paden naar `/opt/plesk/node/...` falen daar) — zie §7 hieronder. Voer de deploy-acties in plaats daarvan handmatig uit via SSH, na elke `git pull`/publicatie:
   ```bash
   cd /var/www/vhosts/nicenext.nl/tool.nicenext.nl/tool
   sudo -u <plesk-systeemgebruiker> env PATH=/opt/plesk/node/21/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin npm ci --ignore-scripts
   sudo -u <plesk-systeemgebruiker> env PATH=/opt/plesk/node/21/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin npm run postinstall
   sudo -u <plesk-systeemgebruiker> env PATH=/opt/plesk/node/21/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin npm run deploy:check
   sudo -u <plesk-systeemgebruiker> env PATH=/opt/plesk/node/21/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin npm run db:backup
   sudo -u <plesk-systeemgebruiker> env PATH=/opt/plesk/node/21/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin npm run db:migrate
   sudo -u <plesk-systeemgebruiker> env PATH=/opt/plesk/node/21/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin npm run build:server
   ```
   Daarna "App opnieuw opstarten" in het Node.js-paneel. (Geen `npm run verify` en geen `npm run build:web`/`npm run build` hier — zie "Node-versie" hierboven; `dist/web/` komt al gebouwd mee via Git.)
4. `npm run healthcheck` moet slagen.

### Waarom `--ignore-scripts` + losse `postinstall`?

`npm ci` (zonder `--ignore-scripts`) laat `@prisma/client` zijn eigen `postinstall`-script draaien. Op deze server crasht dat met een syntax-fout (`Unexpected token '?'`) omdat dat geneste proces terugvalt op een oeroude systeem-`node` (`/usr/bin/node`, v12) in plaats van Plesk's beheerde Node 21 — ook al rapporteert `npm` zelf (voor de EBADENGINE-checks) correct v21.7.3. `--ignore-scripts` slaat dat over; de losse `npm run postinstall` (= `prisma generate`, zie `package.json`) draait daarna als gewoon top-level `npm run`-commando, wat met de expliciete `PATH` hierboven wél goed gaat.

### Document Root

Document root wijst rechtstreeks naar `dist/web` (de gebouwde frontend), **niet** naar een losse, lege `public/`-map. Met `base: '/'` in `vite.config.ts` (geen subpad meer) kloppen de asset-URL's in `index.html` (`/assets/...`) nu exact met de bestandsstructuur onder `dist/web/assets/...`, dus Apache/Passenger kan statische assets ook rechtstreeks serveren zonder dat Express daarvoor nodig is.

## 3. Scheduled Tasks

Kritieke planning staat bewust **niet** in een gebruikersverzoek: een extern verzoek start elke ronde van het jobrunner (dagelijkse jobs inplannen en de wachtrij verwerken).

**Cron-taken op s1.gblict.nl draaien in een afgeschermde (chroot-)shell.** Daarin bestaat `/var/www/vhosts/...` niet (alleen `/tool.nicenext.nl/...`) en ook `/opt/plesk/node` niet, dus een taak "Een opdracht uitvoeren" met `node run-jobs.js` faalt (`cd: ... No such file or directory`). Daarom start een taak van het type **"Een URL ophalen"** het jobrunner via een beveiligd endpoint van de app zelf. Dat werkt op elke Plesk-installatie, ongeacht shell- of chroot-instellingen.

### Jobrunner (elke 10 minuten)

1. Zet `LEAD_GENERATION_CRON_SECRET` (min. 24 tekens, bv. `openssl rand -base64 32`; gebruik bij voorkeur alleen letters en cijfers, dan hoeft het niet te worden ge-escaped in de URL) in de Node.js-variabelen én in de `.env` in de app-root. Herstart de app.
2. Plesk → `nicenext.nl` → Geplande taken → **Taak toevoegen**: soort **Een URL ophalen**, schema **Cron-stijl** `*/10 * * * *`, URL:
   ```
   https://cron:<LEAD_GENERATION_CRON_SECRET>@tool.nicenext.nl/internal/run-jobs
   ```
3. Het endpoint antwoordt direct met `202` (`started`, of `busy` als er in dat proces al een ronde loopt) en voert de ronde op de achtergrond uit; het resultaat staat als `Jobrunner klaar` in het app-log (`LOG_FILE`). `401` = verkeerd wachtwoord, `503` = secret niet ingesteld. Controleer na het aanmaken met "Nu uitvoeren".

Waar cron wél bij Node kan (andere server), werkt ook de CLI: `cd <app-root> && /pad/naar/node dist/server/src/server/run-jobs.js` (exitcode 2 = er zijn jobs definitief mislukt).

### Database-back-up

`npm run db:backup` (mysqldump buiten de webroot, zie runbook) hoort bij de deploy-stappen in §2 (vóór elke migratie). Een dagelijkse back-up kan om dezelfde reden niet vanuit cron-in-chroot op deze server: gebruik daarvoor Plesk's **Back-upbeheer** (Extra's → Back-upbeheer → geplande back-up van het abonnement, inclusief databases) of een back-up op serverniveau.

## 4. Logs

- Plesk → Node.js → Logs, en `/var/www/vhosts/system/tool.nicenext.nl/logs/`. Applicatielogs zijn JSON (pino) zonder secrets.
- Als Apache/Passenger-logging onbetrouwbaar blijkt (zie §7) kan `LOG_FILE` (optioneel) de app een eigen, altijd-beschikbaar logbestand geven, los van wat Apache/Passenger wel of niet doorgeeft — zie `docs/deployment/environment-variables.md`.

## 5. Rollback

1. `git tag` bij elke release (`v0.x.y`).
2. Code: in Plesk Git de vorige tag/commit deployen (`git checkout <tag>`), de deploy-acties uit §2 handmatig herhalen (die tag heeft zijn eigen `dist/web/` al meegecommit), restart.
3. Database: migraties zijn expand/contract; controleer vóór rollback of het oude schema compatibel is. Anders herstel de back-up van vóór de migratie (`docs/operations/runbook.md`).

## 6. Debuggen van een 500 zonder logregel

Mocht een request een 500 geven terwijl noch het per-domein Apache-log, noch het globale Apache-log,
noch Passenger's eigen log (zelfs met `PassengerLogLevel 6` en een volledige `apache2 restart`, niet
alleen een `reload` — Passenger's Watchdog-proces leest sommige eigen directives niet opnieuw bij een
kale reload) iets toont:

1. Bevestig eerst of de app zelf werkt, los van Apache/Passenger: `sudo -u <systeemgebruiker> /opt/plesk/node/21/bin/node passenger-start.cjs` vanuit de app-root. Start de app hier niet, dan zit het probleem in de code/omgevingsvariabelen, niet in Apache/Passenger.
2. Vergelijk de gegenereerde vhost-config (`/etc/apache2/plesk.conf.d/vhosts/<domein>.conf`) met die van een bevestigd werkende Node.js-app op dezelfde server.
3. Blijft het raadsel bestaan: dit is dan het moment om Plesk/hosting-support te vragen naar Passenger-spawngedrag en eventuele beveiligingsmodules (AppArmor, cgroups) die een proces stilletjes kunnen blokkeren zonder dat dit in Apache's of Passengers eigen logconfiguratie terechtkomt.

## 7. Bekende valkuilen van deze server (s1.gblict.nl)

- **Git-paneel "Aanvullende acties bij publicatie" draait in een beperkte shell** zonder bruikbare `PATH` — zelfs `whoami` en absolute paden naar `/opt/plesk/node/...` falen daar met "No such file or directory" / "command not found". Gebruik SSH met een expliciete `PATH` in plaats daarvan (zie §2).
- **Een losse systeem-`node` (v12, via apt) staat op de normale `PATH`**, naast Plesk's beheerde Node 21 onder `/opt/plesk/node/21/bin`. Alles wat een proces spawnt met een kaal `node`/`npm` (zoals `@prisma/client`'s eigen `postinstall`-hook) kan daardoor per ongeluk de oude v12 raken, ook als het eigen `npm`-commando zelf wél de juiste versie gebruikt. Zet `/opt/plesk/node/21/bin` expliciet vooraan in `PATH` voor elk commando dat geneste node-processen kan starten.
- **Het Passenger-opstartbestand moet CommonJS zijn.** Passenger's node-loader (`/usr/share/passenger/helper-scripts/node-loader.js`, regel `require(startupFile)`) laadt het opstartbestand met `require()`. De app is een ES-module (`"type": "module"`) en Node < 22.12 (Plesk biedt 21.7.3) kan zo'n module niet `require()`-en (ERR_REQUIRE_ESM): de app start dan nooit, zonder enige logregel in Apache, nginx of Passenger — een 500 met Passenger's eigen foutpagina. Daarom is het startup file `passenger-start.cjs`, dat de app met een dynamische `import()` laadt. Dit was de hoofdoorzaak van de aanvankelijke 500's (zie de debug-sectie hierboven).
- **`passenger-status` faalt met "too long unix socket path"** voor deze specifieke Apache-Passenger-instantie — dit bleek een afzonderlijk probleem met Passenger's eigen admin-/statussocket, niet (aantoonbaar) gerelateerd aan de requestafhandeling zelf.
