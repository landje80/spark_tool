# Outreach (Fase F)

## Workflow (expliciet, nooit automatisch)

1. Medewerker opent een prospect en maakt een **concept** (AI of sjabloon).
2. Medewerker **bewerkt** onderwerp en platte tekst. HTML wordt server-side uit die tekst gebouwd en volledig geëscaped; ruwe HTML van gebruiker of AI komt nooit in een mail.
3. **Voorbeeld** (`prepare-send`): server valideert ontvanger, afzender, suppressie, prospectstatus en dagelijks limiet en toont de definitieve mail (afzender, ontvanger, onderwerp, tekst, automatische footer). Uitvoer is een `confirmToken` (HMAC, 10 min) dat **ontvanger + inhoud** bindt.
4. Medewerker vinkt de bevestiging aan en klikt **Definitief verzenden**. Wijzigt het concept of de ontvanger daarna, dan wordt het token geweigerd.
5. Server claimt de verzending (unieke `idempotencyKey` = concept + ontvanger + inhoud), roept Postmark aan **buiten** de databasetransactie en legt daarna in één transactie vast: `EmailMessage` (SENT + Postmark `MessageID`), concept SENT + goedkeurder, prospect → "Gemaild", activiteit `EMAIL_SENT`, optionele opvolgtaak + volgende actiedatum, auditlog.

## Bescherming

- Nooit vanuit de browser naar Postmark; token alleen server-side. Tests gebruiken altijd een mock; de standaardpoort in de testomgeving weigert te verzenden.
- **Suppressie**: alleen SHA-256-hash van het adres (blijft werken na verwijderen van een prospect). Bronnen: opt-out via afmeldlink, harde bounce, spamklacht, Postmark-suppressie (`SubscriptionChange`), handmatig ("Niet meer mailen"), afmelding per antwoord.
- **Geen verzending** naar: gesuppresseerde adressen, prospects met gesloten status (niet geïnteresseerd, klant, gearchiveerd, ongeldig, dubbel), boven het dagelijks limiet (standaard 50), zonder geldige bevestiging.
- **Header-injectie**: onderwerp/ontvanger mogen geen regeleinden of NUL bevatten (server-side, naast Zod); afzendernaam wordt gesaneerd.
- **Opt-out**: elke mail bevat een persoonlijke afmeldlink (footer + `List-Unsubscribe` + `List-Unsubscribe-Post` one-click) en de afzenderidentificatie uit de instellingen.
- **Rate limit**: verzenden 20/min per gebruiker + dagelijks limiet in de database.

## Webhooks

Authenticatie: Basic Auth over HTTPS (zie API-doc; Postmark biedt geen HMAC), wachtwoord ≥32 tekens (afgedwongen in `env.ts`). Aanbevolen aanvulling: IP-allowlist van Postmark in Apache. Elk event heeft een unieke sleutel (`WebhookEvent.externalKey`); aanmaak, verwerking en markering lopen onder een named lock in één transactie (`spark:webhook:<key>`), zodat (a) twee gelijktijdige aanleveringen van hetzelfde event (Postmark-hertries, load balancers) elkaar niet kunnen inhalen, en (b) een fout halverwege alles terugdraait — een volgende hertry verwerkt het event dan volledig opnieuw in plaats van dubbele activiteiten/taken achter te laten. Bij een fout geeft de route 500 (Postmark probeert het later opnieuw); de foutmelding wordt buiten de transactie om op het event vastgelegd voor zichtbaarheid. Er worden **geen mailbodies of bijlagen** in `WebhookEvent` bewaard; van antwoorden alleen de "stripped reply" (max. 2000 tekens) als activiteit.

**Antwoorden koppelen:** Reply-To is `reply+<emailMessageId>@POSTMARK_INBOUND_DOMAIN`; Postmark levert het deel na `+` als `MailboxHash`. Dat is een onraadbaar, door onszelf uitgegeven token en dus **betrouwbaar**. De `From`-header van een inkomende mail is dat niet: Postmark authenticeert die niet voordat de webhook wordt aangeroepen, dus iedereen kan een mail "van" een bestaand contactadres sturen. Daarom geldt: alleen een reactie die via `MailboxHash` gekoppeld is, leidt automatisch tot suppressie of status "Reactie - geen interesse" bij een afmeldverzoek. Een reactie die alleen via het (spoofbare) afzenderadres is gekoppeld, wordt wel als "Reactie ontvangen" geregistreerd met een taak, maar een gedetecteerd afmeldverzoek daarin wordt **niet** automatisch verwerkt — de activiteit en de taak vermelden expliciet dat de koppeling onzeker is, zodat een medewerker het beoordeelt. Automatische antwoorden (afwezig) veranderen niets.

## Eigenaar: inrichting in Postmark (niet door de app te doen)

1. Sender Signature/domein `nicenext.nl` verifiëren (DKIM + Return-Path); SPF/DMARC controleren.
2. Message Stream `outbound` (transactioneel) of een aparte Broadcast-stream voor outreach; noteer de naam in `POSTMARK_MESSAGE_STREAM`.
3. Webhooks (Settings → Webhooks) op de stream: URL `https://postmark:<POSTMARK_WEBHOOK_SECRET>@spark.nicenext.nl/tool/webhooks/postmark`; vink Delivery, Bounce, Spam complaint, Subscription change (en optioneel Open/Click) aan. Test met de knop "Send test".
4. Inbound: inbound-domein of -adres instellen op dezelfde URL; zet `POSTMARK_INBOUND_DOMAIN`.
5. Instellingen → E-mail en outreach: vul de afzenderregel volledig in (naam, adres, KvK).

## Juridisch (door de verwerkingsverantwoordelijke vast te stellen)

Koude B2B-e-mail valt onder de Telecommunicatiewet (art. 11.7) en de AVG (gerechtvaardigd belang, informatieplicht). De app biedt technische middelen (identificatie, afmelden, suppressie, bronvermelding) maar garandeert geen conformiteit.
