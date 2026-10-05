# Leadgeneratie (Fase E)

## Doel en grenzen

Dagelijks maximaal `LEAD_GENERATION_DAILY_TARGET` (10) nieuwe, gekwalificeerde prospects vinden voor het Spark-team. De job **verstuurt nooit e-mail** en maakt geen outreachconcepten; alles landt als prospect in het CRM of in de reviewqueue.

## Pijplijn (twee fasen)

1. **Onderzoek** (`LeadResearchClient.research`): Messages API met de server-side tools `web_search` (`max_uses = ANTHROPIC_WEB_SEARCH_MAX_USES`) en `web_fetch` (alleen `spark.nicenext.nl`, om Sparks diensten te lezen). Streamend; `pause_turn` wordt hervat (max. 5 keer). De client legt alle URL's vast die **werkelijk** in zoek- en ophaalresultaten voorkwamen.
2. **Extractie** (`LeadResearchClient.extract`): tweede aanroep **zonder tools** die de notities omzet naar het strikte schema (`output_config.format` via `zodOutputFormat`, `messages.parse`).
3. **Server-side validatie** (`validate.ts`, Zod + regels): harde afwijzing bij regio/branche/website/socials/medewerkers-minimum of zonder verifieerbare bron; twijfel (lage betrouwbaarheid, onbekend medewerkersaantal, niet-gecontroleerde website, toon) → status `IN_REVIEW`.
4. **Deduplicatie** onder de `PROSPECT_WRITE_LOCK`: exact → telt als duplicaat; fuzzy → `LeadCandidate` in de reviewqueue; anders prospect + bronnen + sociale profielen + activiteit.

**Waarom twee fasen:** de combinatie van `output_config.format` met web search (citaties) is niet door ons geverifieerd; twee stappen zijn robuust en laten toe de bronnen server-side tegen de echte zoekresultaten te controleren. (Te heroverwegen bij een dependency-/modelupgrade; ADR-007.)

## Anti-hallucinatie en prompt-injectie

Webinhoud is onbetrouwbare invoer. Mitigaties: (a) het model heeft geen tools met zij-effecten (alleen zoeken/ophalen) en de prompts noemen webinhoud expliciet _data, geen instructies_; (b) bronnen worden alleen geaccepteerd als de URL in de echte zoekresultaten stond; (c) socialmedia-URL's moeten bij het juiste platformdomein horen, LinkedIn alleen als bedrijfspagina (`/company/`, `/school/`, `/showcase/`), nooit persoonlijke profielen; (d) uitvoer is strikt geschema't, server-side opnieuw gevalideerd en tekstvelden zijn lengtebegrensd; (e) e-mailadressen worden alleen bewaard als functioneel adres (`info@`, `contact@`, …) op het eigen domein; (f) een kandidaat waarvan website, sociale profielen of medewerkersbron niet in de zoekresultaten teruggevonden zijn krijgt status `IN_REVIEW` in plaats van `NEW`; (g) bestaande bedrijfsnamen die aan het model worden meegegeven zijn gesaneerd en als data afgebakend (tweede-orde-injectie); (h) de UI toont links uitsluitend als `http(s)`. Prompttekst en schema zijn versiebeheerd (`PromptVersion`, sha256).

**Restrisico:** provincie, plaats en medewerkersaantal blijven modelclaims met een bron. Elke prospect wordt door een medewerker beoordeeld vóór er iets wordt verstuurd; er is geen automatische opvolging.

## Idempotentie, budget en fouten

- **Eén actieve run tegelijk:** `claimRun` claimt onder een named lock (`spark:leadgen-claim`); een tweede worker of een handmatige run naast een lopende run wordt overgeslagen (`already_running`). Een `RUNNING`-run ouder dan 90 minuten geldt als gecrasht en wordt overgenomen; de jobwachtrij herplant vastgelopen jobs pas na 120 minuten (en zet ze op `DEAD` als alle pogingen verbruikt zijn).
- Dagelijks `runKey = daily-YYYY-MM-DD` (lokale dag): een geslaagde run wordt nooit herhaald; een mislukte of gedeeltelijke run wordt hervat (zelfde rij).
- **Dagbudget:** vóór een run wordt de som van `estimatedCostUsd` van vandaag gecontroleerd (`ANTHROPIC_MAX_DAILY_COST`). Verbruik wordt **per beurt** geboekt (ook bij een latere crash) en het onderzoek stopt zodra het budget is bereikt (`budget_stop` → run `PARTIAL`, wat er is wordt nog verwerkt); bij > 2× budget na het onderzoek wordt de extractie geweigerd. Een betaalde aanroep die faalt zonder bekend verbruik boekt een forfaitair bedrag ($0,25), zodat retries het budget niet omzeilen. Web search wordt over alle hervattingen heen begrensd op `ANTHROPIC_WEB_SEARCH_MAX_USES`. Kosten komen uit `usage` (tokens + `web_search_requests`) × indicatieve prijzen in `integrations/anthropic/cost.ts` (onbekend model = duurste tarief).
- **Betaald onderzoek gaat niet verloren:** de onderzoeksnotities en gezien-URL's worden meteen in `run.metadata` bewaard; faalt de extractie, dan hergebruikt de volgende poging ze zonder opnieuw te zoeken.
- Fouten per kandidaat stoppen de run niet (status `PARTIAL`, foutmelding op de run); een technische fout zet de run op `FAILED` en de job herprobeert met begrensde exponentiële backoff (1, 2, 4 … max. 60 min, daarna `DEAD`). Foutmeldingen worden geschoond: sleutels gemaskeerd, van Prisma-fouten alleen naam en code.
- Een niet-geconfigureerde leadgeneratie laat de job **zichtbaar mislukken** (niet stil slagen). Handmatige runs krijgen geen automatische herhaling en er staat maximaal één leadrun tegelijk in de wachtrij.

## Planning

Eén Plesk Scheduled Task, elke ~10 minuten: `npm run jobs:run` (`dist/server/src/server/run-jobs.js`), of op hosting waar cron niet bij Node kan een "URL ophalen"-taak op `/internal/run-jobs`. Die plant idempotent de dagelijkse jobs in (leadrun pas na 06:30 lokale tijd en alleen als ingeschakeld en geconfigureerd, plus onderhoud) en verwerkt de wachtrij. Handmatige runs (UI) komen zo ook aan bod. Een niet-nul exitcode (2) betekent dat er jobs definitief mislukt zijn.

## Beheer

Instellingen → Dagelijkse leadgeneratie: schakelaar, dagbudget/verbruik, laatste geslaagde run, recente runs (kosten, tokens, zoekopdrachten, fouten), handmatig starten. Dashboard toont recente runs en het aantal mislukte jobs.

## Nog niet geverifieerd tegen de echte API

Alle tests gebruiken een mock (`src/test/mock-lead-client.ts`). De echte `AnthropicLeadClient` is getypt tegen SDK 0.127 maar nog niet met een echte sleutel gedraaid. Bij de eerste echte run controleren: modelnaam/web search-beschikbaarheid voor het account, of `web_fetch` op `spark.nicenext.nl` slaagt, de werkelijke kosten versus de schatting, en de kwaliteit van de kandidaten.
