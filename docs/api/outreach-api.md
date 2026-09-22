# Outreach-API

Basispad `/tool/api` (achter sessie + CSRF), plus twee **publieke** routes onder `/tool` (zonder sessie).

## Authenticated

| Methode  | Pad                                 | Recht              | Doel                                                                                                                                                            |
| -------- | ----------------------------------- | ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST     | `/prospects/:id/drafts`             | `outreach.prepare` | Maakt een conceptmail (AI als `ANTHROPIC_MODEL_CONTENT` is ingesteld, anders sjabloon). Prospect → "Outreach voorbereid"                                        |
| GET      | `/outreach/drafts/:id`              | `outreach.prepare` | Concept + alinea's                                                                                                                                              |
| PATCH    | `/outreach/drafts/:id`              | `outreach.prepare` | `{subject, textBody}`; alleen zolang status `DRAFT`. HTML wordt server-side uit platte tekst opgebouwd                                                          |
| POST     | `/outreach/drafts/:id/discard`      | `outreach.prepare` | Verwijdert het concept                                                                                                                                          |
| POST     | `/outreach/drafts/:id/prepare-send` | `outreach.send`    | `{to?}` valideert alles en levert een **preview** + `confirmToken` (10 min geldig, gebonden aan ontvanger en inhoud)                                            |
| POST     | `/outreach/drafts/:id/send`         | `outreach.send`    | `{to, confirmToken, followUpDays?}` verstuurt na bevestiging. Idempotent. 201 = verstuurd, 200 `duplicate` = eerder verstuurd                                   |
| POST     | `/prospects/:id/replies`            | `prospect.write`   | `{text, notInterested}` legt een antwoord handmatig vast                                                                                                        |
| POST     | `/outreach/suppressions`            | `outreach.send`    | `{email}` blokkeert een adres (alleen de hash wordt bewaard)                                                                                                    |
| GET/POST | `/admin/outreach`                   | `settings.manage`  | Dagelijks limiet, open-tracking, afzenderregel. GET geeft ook `stuckQueued` (verzonden mails waarvan de registratie mislukte, zie runbook) en `footerIsDefault` |

**Foutcodes** (409 met `details.reason`): `not_configured`, `suppressed`, `inactive_recipient`, `prospect_closed`, `confirm_invalid`, `content_changed`; 429 `daily_limit`; 502 `UPSTREAM_ERROR` (mailprovider).

## Publiek (zonder sessie)

| Methode  | Pad                        | Beveiliging                                                                                                                                                                                                                                                                                                                           |
| -------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST     | `/tool/webhooks/postmark`  | HTTP Basic Auth (`postmark` : `POSTMARK_WEBHOOK_SECRET`, ≥32 tekens) over HTTPS; Postmark kent geen HMAC-handtekeningen. Idempotent én atomair per event (named lock + transactie) via `WebhookEvent.externalKey`. 401 bij verkeerde gegevens, 503 zonder geheim, 500 bij een verwerkingsfout (Postmark probeert 5xx/408/429 opnieuw) |
| GET/POST | `/tool/unsubscribe/:token` | Token = HMAC per verzonden mail. GET toont een bevestigingspagina (geen bijwerking), POST meldt af (ook one-click via `List-Unsubscribe-Post`)                                                                                                                                                                                        |

Verwerkte events: `Delivery`, `Bounce` (hard → suppressie), `SpamComplaint` (suppressie + prospect niet meer benaderen), `Open`, `Click`, `SubscriptionChange`, en **inbound** (antwoorden).
