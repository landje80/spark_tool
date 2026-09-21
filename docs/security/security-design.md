# Securityontwerp en threat model

## Assets

Prospectgegevens (bedrijfs- en contactgegevens), klantmateriaal (foto/video), API-sleutels (Postmark, Anthropic, Entra), sessies, e-mailreputatie van Spark, auditlog.

## Trust boundaries

Internet ↔ Apache/Passenger ↔ Node ↔ MySQL / private opslag; Node ↔ Entra, Postmark, Anthropic (uitgaand); Postmark → webhooks (inkomend, onbetrouwbaar tot geverifieerd); klantbrowser met uploadtoken (beperkt vertrouwen).

## Aanvalsvectoren en mitigaties

| Vector                              | Mitigatie                                                                                                 | Status                                 |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| Ongeautoriseerde login              | Single-tenant authority; tid/aud/iss/nonce/state; PKCE; default-deny allowlist; getest (`access.test.ts`) | Gebouwd                                |
| Sessiediefstal/fixatie              | Server-side sessie, hash van sid in DB, rotatie na login, HttpOnly/Secure/SameSite=Lax, 8 u rolling       | Gebouwd                                |
| CSRF                                | Synchronizer-token (`x-csrf-token`) + Origin-check op alle niet-GET                                       | Gebouwd                                |
| XSS                                 | React-escaping, strikte CSP (`script-src 'self'`), geen inline scripts, sanitization van e-mail-HTML      | CSP gebouwd; e-mail-sanitization volgt |
| Open redirect                       | `safeReturnTo` beperkt tot basispad                                                                       | Gebouwd                                |
| Brute force / misbruik              | `express-rate-limit` op auth (30/15 min) en API (300/min)                                                 | Gebouwd                                |
| Ontbrekende autorisatie             | `requirePermission` per endpoint; permissiematrix per rol                                                 | Basis gebouwd; per endpoint bij Fase D |
| Secrets in Git/logs                 | `.gitignore`, pino-redactie, env-validatie toont nooit waarden, hooks blokkeren `.env`-commits            | Deels                                  |
| Upload: malware/pad-traversal/MIME  | MIME-sniffing (`file-type`), gegenereerde sleutels, opslag buiten docroot, virusscan-interface            | Fase G                                 |
| SSRF                                | Alleen allowlisted hosts bij ophalen externe URL's; geen gebruikersgestuurde fetch                        | Fase E/G                               |
| Webhook-spoofing                    | Basic Auth-geheim + constant-time vergelijking; idempotente verwerking via `WebhookEvent.externalKey`     | Fase F                                 |
| Dubbel mailen / mailen naar opt-out | `idempotencyKey`, suppressielijst (hash), harde blokkade bij bounce/spam                                  | Schema klaar; service Fase F           |
| Kostenexplosie AI                   | `ANTHROPIC_MAX_DAILY_COST`, `WEB_SEARCH_MAX_USES`, runKey-idempotentie                                    | Fase E                                 |
| Kwetsbare dependencies              | `npm run audit:deps` in `verify`; allowlist gedocumenteerd (ADR-001)                                      | Gebouwd                                |

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

## Privacy en AVG (technische maatregelen, geen juridische claim)

Opgeslagen: bedrijfsgegevens, openbare bronnen + onderzoeksdatum, zakelijk contactadres indien openbaar gepubliceerd. Doel: B2B-opvolging door Spark. Bewaartermijn: `PROSPECT_RETENTION_DAYS`. Nog te bouwen: export per prospect, anonimiseren, retentiejob. Door de verwerkingsverantwoordelijke / jurist vast te stellen: grondslag (gerechtvaardigd belang, ePrivacy/Telecommunicatiewet voor koude e-mail), informatieplicht en bezwaarprocedure, verwerkersovereenkomsten (Postmark, Anthropic, Microsoft).
