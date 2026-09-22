# Securityontwerp en threat model

## Assets

Prospectgegevens (bedrijfs- en contactgegevens), klantmateriaal (foto/video), API-sleutels (Postmark, Anthropic, Entra), sessies, e-mailreputatie van Spark, auditlog.

## Trust boundaries

Internet ↔ Apache/Passenger ↔ Node ↔ MySQL / private opslag; Node ↔ Entra, Postmark, Anthropic (uitgaand); Postmark → webhooks (inkomend, onbetrouwbaar tot geverifieerd); klantbrowser met uploadtoken (beperkt vertrouwen).

## Aanvalsvectoren en mitigaties

| Vector                              | Mitigatie                                                                                                                                                                                                                                                   | Status                                 |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| Ongeautoriseerde login              | Single-tenant authority; tid/aud/iss/nonce/state; PKCE; default-deny allowlist; getest (`access.test.ts`)                                                                                                                                                   | Gebouwd                                |
| Sessiediefstal/fixatie              | Server-side sessie, hash van sid in DB, rotatie na login, HttpOnly/Secure/SameSite=Lax, 8 u rolling                                                                                                                                                         | Gebouwd                                |
| CSRF                                | Synchronizer-token (`x-csrf-token`) + Origin-check op alle niet-GET                                                                                                                                                                                         | Gebouwd                                |
| XSS                                 | React-escaping, strikte CSP (`script-src 'self'`), geen inline scripts, sanitization van e-mail-HTML                                                                                                                                                        | CSP gebouwd; e-mail-sanitization volgt |
| Open redirect                       | `safeReturnTo` beperkt tot basispad                                                                                                                                                                                                                         | Gebouwd                                |
| Brute force / misbruik              | `express-rate-limit` op auth (30/15 min) en API (300/min)                                                                                                                                                                                                   | Gebouwd                                |
| Ontbrekende autorisatie             | `requirePermission` per endpoint; permissiematrix per rol                                                                                                                                                                                                   | Basis gebouwd; per endpoint bij Fase D |
| Secrets in Git/logs                 | `.gitignore`, pino-redactie, env-validatie toont nooit waarden, hooks blokkeren `.env`-commits                                                                                                                                                              | Deels                                  |
| Upload: malware/pad-traversal/MIME  | MIME-sniffing (`file-type`), gegenereerde sleutels, opslag buiten docroot, virusscan-interface                                                                                                                                                              | Fase G                                 |
| SSRF                                | Geen gebruikersgestuurde server-side fetch; `web_fetch` van het model draait bij Anthropic en is beperkt tot `spark.nicenext.nl`                                                                                                                            | Fase E: gebouwd; Fase G open           |
| Webhook-spoofing                    | Basic Auth-geheim (≥32 tekens, constant-time vergelijking); idempotente + atomaire verwerking per event (named lock + transactie, zie outreach.md)                                                                                                          | Gebouwd                                |
| Dubbel mailen / mailen naar opt-out | `idempotencyKey` + guarded claim in de afrondingstransactie, suppressie (hash), harde blokkade bij bounce/spam                                                                                                                                              | Gebouwd                                |
| Suppressie-spoofing via antwoord    | Alleen een antwoord gekoppeld via het onraadbare plus-adres (`MailboxHash`) leidt tot automatische suppressie/"niet geïnteresseerd"; koppeling via alleen het (spoofbare) afzenderadres registreert de reactie maar wijzigt niets automatisch               | Gebouwd; zie outreach.md               |
| Kostenexplosie AI                   | Dagbudget met verbruik per beurt, één actieve run (named lock), zoeklimiet over alle hervattingen, forfaitaire kostenpost bij mislukte calls, één openstaande handmatige run, runKey-idempotentie                                                           | Gebouwd (mock-getest)                  |
| Prompt-injectie via webinhoud       | Model zonder zij-effecten; webinhoud = data; bronverificatie tegen echte zoekresultaten; strikt schema + server-validatie; alleen bedrijfspagina's en functionele e-mailadressen; twijfel → `IN_REVIEW`; menselijke review; UI toont alleen `http(s)`-links | Gebouwd; zie lead-generation.md        |
| Kwetsbare dependencies              | `npm run audit:deps` in `verify`; allowlist gedocumenteerd (ADR-001)                                                                                                                                                                                        | Gebouwd                                |

## Restrisico's

- `SameSite=Lax` (noodzakelijk voor OIDC-terugkeer) → CSRF steunt op token + Origin.
- Groepen-overage: gebruikers in >200 groepen worden geweigerd tenzij via gebruikers-ID toegestaan.
- Bootstrap-admin: eerste toegestane gebruiker wordt ADMIN; beperk de allowlist bij eerste uitrol tot de beoogde beheerder.
- Prisma-CLI `deepmerge-ts` advisory (zie ADR-001).
- `TRUST_PROXY=true` staat bewust aan (Passenger/Apache staat altijd vóór Node; nodig voor `secure` cookies en IP-adres). Node mag niet rechtstreeks op internet bereikbaar zijn; anders is `X-Forwarded-For` te vervalsen.
- Duplicaatcontrole gebruikt kandidaatqueries (max. 500) op begin/einde van de genormaliseerde naam; een zeer afwijkend geschreven naam wordt niet als fuzzy duplicaat herkend.
- `@@unique([normalizedName, city])` beschermt niet bij `city = NULL` (MariaDB behandelt NULL als uniek); de applicatiecontrole vangt dit als fuzzy match op (bevestiging vereist).
- Sessies van gedeactiveerde gebruikers worden pas ongeldig bij de volgende request (`loadUser` controleert `active`); actief verwijderen volgt bij gebruikersbeheer.
- Cascade-regels (`Prospect` → activiteiten/taken/concepten) en `prospect.delete` worden herzien bij de privacy-functies (anonimiseren i.p.v. hard verwijderen); tot dan is er geen delete-endpoint.
- Ontbrekende foreign keys op enkele `*By`/`*Id`-kolommen (`LeadCandidate.reviewedBy`, `PublicationDraft.reviewerId`, …) worden in Fase E/G toegevoegd.
- Outreach kent geen eigenaarscontrole (elke gebruiker met `outreach.send` mag elk concept versturen), consistent met de rest van het CRM dat team-breed werkt; te herzien als per-prospect toegang gewenst is.
- Als de registratie na een écht verzonden mail drie keer mislukt (netwerkstoring), blijft `EmailMessage.status = QUEUED` staan zonder bijbehorende prospectstatus/taak. Instellingen → E-mail en outreach toont dit (`stuckQueued`); handmatig herstel staat in de runbook. Een automatische reconciliatiejob is nog niet gebouwd.
- De standaard afzenderregel (`Spark · https://spark.nicenext.nl`) bevat geen volledige bedrijfsidentificatie (adres, KvK); Instellingen waarschuwt hiervoor totdat een beheerder dit invult.

## Privacy en AVG (technische maatregelen, geen juridische claim)

Opgeslagen: bedrijfsgegevens, openbare bronnen + onderzoeksdatum, zakelijk contactadres indien openbaar gepubliceerd. Doel: B2B-opvolging door Spark. Bewaartermijn: `PROSPECT_RETENTION_DAYS`. Nog te bouwen: export per prospect, anonimiseren, retentiejob. Door de verwerkingsverantwoordelijke / jurist vast te stellen: grondslag (gerechtvaardigd belang, ePrivacy/Telecommunicatiewet voor koude e-mail), informatieplicht en bezwaarprocedure, verwerkersovereenkomsten (Postmark, Anthropic, Microsoft).
