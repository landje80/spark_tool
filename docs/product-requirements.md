# Productvereisten — Spark Tool

Publieke URL: https://spark.nicenext.nl/tool · Taal: Nederlands (centrale tekstlaag, later meertalig) · Mobile first, WCAG 2.2 AA.

## Gebruikers en rollen

| Rol            | Doel                                                        |
| -------------- | ----------------------------------------------------------- |
| ADMIN          | Alles, incl. gebruikers, instellingen, audit                |
| MANAGER        | CRM, outreach, klanten, content-review, export, audit lezen |
| SALES          | Prospects opvolgen, outreach voorbereiden en versturen      |
| CONTENT_EDITOR | Content reviewen, uploadlinks aanmaken                      |
| VIEWER         | Alleen lezen                                                |
| Klant (extern) | Levert content aan via geheime uploadlink (geen login)      |

## Functies

1. **CRM** — prospects, bronnen, sociale profielen, activiteiten, taken, statusmachine, filters/zoeken/sorteren/paginering, bulkacties, CSV-export, samenvoegen, archiveren, notities.
2. **Dashboard** — KPI's, funnel, verdelingen, recente runs, fouten, visuele markering (vandaag, achterstallig, ongereviewd, concept gereed, blokkade).
3. **Dagelijkse leadgeneratie** — Anthropic + web search, strikt schema, Zod-validatie, dedupe, reviewqueue, kostenlimiet, idempotent, nooit zelf mailen.
4. **Outreach** — concept → bewerken → preview → expliciete bevestiging → Postmark; suppressie, idempotency, webhooks (delivery, bounce, spam, open, click, inbound).
5. **Klant worden** — prospect → Customer, BrandProfile (versies).
6. **Content intake** — tijdelijke uploadlink (gehasht token), mobiele uploadpagina, ContentSubmission-workflow, mediapipeline (sharp/ffmpeg), AI-conceptteksten per platform, review-omgeving, PublisherAdapter (mock; **geen** automatische publicatie in fase 1).
7. **Beheer** — health, integratiestatus zonder tokens, jobs/dead-letter, audit.

## Niet-functioneel

Beveiliging volgens `docs/security/security-design.md`; deployment volgens `docs/deployment/plesk-deployment.md`; privacy: bronnen en onderzoeksdatum zichtbaar, export/anonimiseren per prospect, bewaartermijnen configureerbaar. Geen juridische claim van AVG-conformiteit; zie security-design §Privacy.

## Voortgang fase 1 (definitie van klaar, §16)

Zie `docs/architecture/system-design.md` §Status. Stand: fundament, schema, auth/RBAC-basis en shell zijn klaar; CRM-API/UI, leadgeneratie, outreach en content intake zijn **nog niet** gebouwd.
