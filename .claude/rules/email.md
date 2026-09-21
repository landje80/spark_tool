---
paths:
  - 'src/integrations/postmark/**'
  - 'src/modules/outreach/**'
---

# E-mail (Postmark)

- Token alleen server-side; nooit vanuit de browser versturen.
- Vóór verzenden: suppressiecheck (hash), ontvanger/afzenderval., header-injection-controle (geen CR/LF), `idempotencyKey`.
- HTML sanitizen + plain-textversie; verzending alleen na expliciete gebruikersactie.
- Webhooks: authenticiteit controleren, idempotent via `WebhookEvent.externalKey`, harde bounce/spam → suppressie.
- Geen echte verzending in tests.
