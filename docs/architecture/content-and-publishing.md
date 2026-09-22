# Klanten, content-intake en publishing (Fase G)

## Van prospect naar klant

Een prospect wordt handmatig omgezet (`POST /prospects/:id/convert-to-customer`, recht `customer.manage`, alleen vanuit statussen die naar `CUSTOMER` mogen — zie `prospects/status.ts`). In één transactie: `Customer` aangemaakt (gekoppeld via het unieke `Customer.prospectId`), `Prospect.status → CUSTOMER`, activiteit `CONVERTED_TO_CUSTOMER`, auditlog. Een prospect kan maar één keer worden omgezet. Een klant kan ook los worden aangemaakt (zonder prospect) voor bestaande relaties.

## Merkprofiel

`BrandProfile` is vrije JSON (toon, kleuren, schrijfregels, verboden woorden, hashtags, CTA's, disclaimers — geen vast schema, zodat het merkprofiel kan groeien zonder migratie) en **geversioneerd**: elke wijziging maakt een nieuwe rij (`(customerId, version)`), eerdere versies blijven bewaard zodat achteraf te zien is welk merkprofiel een AI-concept destijds kreeg. Precies één versie per klant is `active`; die wordt gebruikt bij contentgeneratie.

## Mobiele upload (geen Microsoft-login)

1. Medewerker maakt een uploadlink (`POST /customers/:id/upload-links`, recht `content.upload_link`): een willekeurig 256-bit token wordt **eenmalig** teruggegeven; de database bewaart alleen de SHA-256-hash (`UploadLink.tokenHash`), net als sessie-id's en afmeldtokens. Optioneel: campagnenaam, geldigheidsduur (uren, standaard `UPLOAD_TOKEN_TTL_HOURS`), maximaal aantal keer gebruiken.
2. De klant opent `${APP_BASE_URL}${APP_BASE_PATH}/upload/<token>` — een publieke, sessieloze pagina (zie `content-intake/public-routes.ts`, gemonteerd vóór de sessie-/CSRF-middleware, net als de outreach-afmeldpagina). Formulier: onderwerp, notitie, bestanden (foto/video, meerdere), verplicht toestemmingsvinkje.
3. Bij een ongeldige, verlopen, ingetrokken of opgebruikte link toont de app altijd dezelfde generieke "link ongeldig"-pagina — nooit een specifieke reden, om te voorkomen dat de foutmelding zelf verraadt of een link ooit heeft bestaan.
4. Elk bestand wordt **eerst volledig gevalideerd** (magic-byte-controle via `file-type`, niet de opgegeven MIME/extensie; grootte tegen `UPLOAD_MAX_IMAGE_MB`/`UPLOAD_MAX_VIDEO_MB`) vóórdat de link wordt geclaimd of er iets wordt opgeslagen. Alleen JPEG/PNG/WEBP (afbeelding) en MP4/QuickTime/WEBM (video) zijn toegestaan; SVG wordt altijd geweigerd (XSS-risico) en wordt door `file-type` sowieso niet als geldig beeld herkend.
5. Het gebruik van de link wordt pas daarna atomair geclaimd (`UploadLink.useCount`, guarded update — zelfde patroon als `jobs/queue.ts`): twee gelijktijdige inzendingen tegen een link met `maxUses = 1` leveren precies één geslaagde `ContentSubmission` op.
6. Opslag via de generieke `StoragePort`-abstractie (zie hieronder); elke `MediaAsset` krijgt een niet-voorspelbare, zelf-gegenereerde opslagsleutel — **nooit** de bestandsnaam van de klant.
7. Een achtergrondjob (`media-technical-check`, dedupeKey = submission-id) verwerkt de media asynchroon (zie hieronder) zodat een trage videoverwerking de HTTP-respons aan de klant niet blokkeert.

## Opslag (ADR-009)

`src/integrations/storage` is een kleine poort (`put`/`get`/`getStream`/`delete`/`exists`) met één implementatie in fase 1: `LocalStorage`, die alles onder `UPLOAD_PRIVATE_PATH` schrijft (buiten de document root op de server). Elke sleutel wordt tegen een strikte regex gecontroleerd én het opgeloste pad moet binnen de basismap blijven (dubbele controle tegen pad-traversal). Een toekomstige S3-compatibele adapter implementeert dezelfde interface; de rest van de app (upload, mediaverwerking, downloadroute) hoeft dan niet te wijzigen.

## Mediaverwerking (gracieuze degradatie)

`src/modules/media-processing` genereert per origineel een webvriendelijke afgeleide (max. 1600 px, WebP) en een vierkante thumbnail via **sharp**; voor video haalt **ffmpeg**/**ffprobe** (aangeroepen als los proces, geen node-package voor de binary zelf — `FFMPEG_PATH`, leeg = zoeken in PATH) duur/resolutie op en een thumbnailframe. Elke stap is defensief: ontbreekt sharp of ffmpeg op de server, is een bestand corrupt, of loopt een aanroep vast (timeout 30 s), dan wordt dat gelogd en gaat de submission gewoon door zonder afgeleide — **de app crasht nooit** op een ontbrekende mediabibliotheek. Er is geen virusscanner geïntegreerd; `MediaAsset.scanStatus` gaat na de MIME-controle naar `SKIPPED` (een eerlijk signaal, nooit een valse `CLEAN`) — zie de restrisico's in `docs/security/security-design.md`.

## Statusmachine

`ContentSubmission.status`: `RECEIVED` (net binnen) → `TECHNICAL_CHECK` (media verwerkt, klaar voor een concept) → `PROCESSING` (AI genereert) → `DRAFT_READY` → `IN_REVIEW`/`CHANGES_REQUESTED` (afgeleid uit de conceptposten, zie hieronder) → `APPROVED` → `READY_TO_PUBLISH` (handmatige stap) → `PUBLISHED` → `ARCHIVED`. `FAILED` is een escape hatch vanuit elke automatische stap (mediaverwerking van één bestand mislukt blokkeert de rest niet; conceptgeneratie die volledig mislukt zet de submission op `FAILED` met `failureReason`, en is vandaaruit opnieuw te proberen).

`PublicationDraft.status` (per platform, eigen levenscyclus): `DRAFT` → `IN_REVIEW`/`APPROVED`/`CHANGES_REQUESTED` → `PUBLISHED`/`DISCARDED`. Bewerken na "wijzigingen gevraagd" gaat automatisch terug naar `DRAFT`. `recalcSubmissionStatus()` (`publishing/status.ts`) leidt de submissionstatus af uit de actieve (niet-verwijderde) conceptposten en wordt na elke wijziging opnieuw toegepast — maar **nooit** buiten de reviewfases (de technische fases en de handmatige stappen `READY_TO_PUBLISH`/`ARCHIVED` worden nooit stilzwijgend overschreven).

## Contentgeneratie (nooit verzonnen feiten)

`publishing/writer.ts`: `ConceptWriter`-interface met een deterministisch `TemplateConceptWriter` (kopieert alleen de letterlijke notitie van de klant, met een expliciete waarschuwing dat er geen AI is gebruikt) en `AiConceptWriter` (via `AnthropicStructuredClient`, `ANTHROPIC_MODEL_CONTENT`). De systeemprompt (`publishing/prompt.ts`) verbiedt verzonnen feiten/producten/cijfers, staat alleen platformen toe die voor de klant zijn geconfigureerd, en behandelt zowel het merkprofiel als de notitie van de klant expliciet als **data, geen instructies** (dezelfde prompt-injectieverdediging als bij leadgeneratie en outreach). Server-side wordt de modeluitvoer nogmaals gefilterd op toegestane platformen — het model wordt nooit vertrouwd om zich daar zelf aan te houden. Elke generatie legt een `PromptVersion` vast (gedeelde `ensurePromptVersion()`-helper, ook gebruikt door leadgeneratie) en maakt **nieuwe versies** aan (`ContentConcept.version`, `PublicationDraft.version`) in plaats van te overschrijven. Genereren claimt de submission atomair (guarded status-update), zodat twee gelijktijdige klikken niet twee keer AI-kosten maken.

## Publiceren: bewust géén automatisch koppelvlak

`publishing/adapter.ts` definieert een `PublisherAdapter`-interface voor toekomstige platformconnectors (LinkedIn, Facebook, Instagram, TikTok), maar fase 1 levert alleen een `DisabledPublisherAdapter` die altijd weigert. De knop "Markeer als geplaatst" (alleen vanuit `APPROVED`) is een **handmatige, achteraf bevestigde registratie** dat een medewerker zelf op het platform heeft geplaatst — geen "publiceer nu"-actie. `settings.publishing.autoPublish` staat op `false` en wordt in fase 1 nergens gelezen.

## Voorvertoning in de review-UI

`GET /api/media-assets/:id/file` (leesrecht `customer.manage`/`content.upload_link`/`content.review`) streamt het bestand vanaf de opslag naar de ingelogde medewerker (nooit publiek, nooit met de bestandsnaam van de klant in de URL). Afbeeldingen en thumbnails komen zo in `<img>`-tags in de reviewpagina terecht; video's en originelen zijn te openen als directe download/voorvertoning in een nieuw tabblad.
