# Klanten-, content- en publishing-API

Basispad `/api` (achter sessie + CSRF), plus één **publieke** route onder `/upload` (zonder sessie, tokengebonden).

## Klanten (`customer.manage` schrijven; lezen ook met `content.upload_link`/`content.review`)

| Methode | Pad                                  | Recht             | Doel                                                                |
| ------- | ------------------------------------ | ----------------- | ------------------------------------------------------------------- |
| GET     | `/customers`                         | lezen             | Lijst, met zoeken (`q`) en statusfilter                             |
| POST    | `/customers`                         | `customer.manage` | Klant los aanmaken (zonder prospect)                                |
| GET     | `/customers/:id`                     | lezen             | Detail: merkprofielversies, uploadlinks, aanleveringen              |
| PATCH   | `/customers/:id`                     | `customer.manage` | Naam/status/contact/toegestane platformen/standaardtoon bijwerken   |
| POST    | `/prospects/:id/convert-to-customer` | `customer.manage` | Zet een prospect om (alleen vanuit een toegestane status); eenmalig |

## Merkprofiel en uploadlinks

| Methode | Pad                                                 | Recht                 | Doel                                                                                      |
| ------- | --------------------------------------------------- | --------------------- | ----------------------------------------------------------------------------------------- |
| POST    | `/customers/:id/upload-links`                       | `content.upload_link` | Maakt een link; `token` staat **alleen in dit antwoord** (nooit opnieuw op te vragen)     |
| POST    | `/upload-links/:id/revoke`                          | `content.upload_link` | Trekt een link direct in (idempotent)                                                     |
| POST    | `/customers/:id/brand-profiles`                     | `customer.manage`     | Nieuwe geversioneerde profielversie (`data`: vrije JSON, `activate`: meteen actief maken) |
| POST    | `/customers/:id/brand-profiles/:profileId/activate` | `customer.manage`     | Maakt een eerdere versie weer actief                                                      |
| GET     | `/media-assets/:id/file`                            | lezen                 | Streamt een bestand (origineel of afgeleide) voor voorvertoning in de review-UI           |

## Aanleveringen en conceptposten (`content.review`, lezen ook breder)

| Methode | Pad                                 | Recht            | Doel                                                                                                         |
| ------- | ----------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------ |
| GET     | `/submissions`                      | lezen            | Lijst, filter op status/klant                                                                                |
| GET     | `/submissions/:id`                  | lezen            | Detail: bestanden, conceptgeschiedenis, conceptposten per platform                                           |
| POST    | `/submissions/:id/generate-concept` | `content.review` | (Her)genereert een concept + posten per toegestaan platform. 409 `invalid_status`/`in_progress` bij een race |
| POST    | `/submissions/:id/advance`          | `content.review` | `{to: 'READY_TO_PUBLISH'\|'ARCHIVED'}`, handmatige stap buiten de reviewafleiding om                         |
| PATCH   | `/drafts/:id`                       | `content.review` | Tekst/hashtags/cta/alt-tekst bewerken; een bewerking na "wijzigingen gevraagd" gaat terug naar `DRAFT`       |
| POST    | `/drafts/:id/status`                | `content.review` | `{to, feedback?}`: `IN_REVIEW`/`APPROVED`/`CHANGES_REQUESTED`/`DISCARDED`                                    |
| POST    | `/drafts/:id/mark-published`        | `content.review` | Registreert een handmatige plaatsing (alleen vanuit `APPROVED`); publiceert nooit zelf                       |

**Foutcodes** (409 met `details.reason`): `invalid_status`, `in_progress` (conceptgeneratie), `link_exhausted` (uploadlink).

## Publiek: mobiele uploadpagina (zonder sessie)

| Methode  | Pad              | Beveiliging                                                                                                                                                                                                                                                                                                                                           |
| -------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET      | `/upload/app.js` | Statisch, geen geheimen; CSP staat alleen same-origin scripts toe                                                                                                                                                                                                                                                                                     |
| GET/POST | `/upload/:token` | Token = SHA-256-hash vergeleken met `UploadLink.tokenHash`. Ongeldig/verlopen/ingetrokken/opgebruikt → altijd dezelfde generieke pagina (404, geen enumeratie). POST: multipart, MIME-sniffing (magic bytes) vóór opslag, grootte tegen `UPLOAD_MAX_IMAGE_MB`/`UPLOAD_MAX_VIDEO_MB`, verplicht toestemmingsvinkje, atomaire claim van het linkgebruik |

Bij een geslaagde inzending wordt een `media-technical-check`-job ingepland (dedupeKey = submission-id) die de sharp/ffmpeg-pijplijn asynchroon uitvoert (zie `docs/architecture/content-and-publishing.md`).
