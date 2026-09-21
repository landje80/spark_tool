---
paths:
  - 'src/server/**'
  - 'src/modules/**/routes.ts'
  - 'src/modules/**/api.ts'
---

# API-endpoints

- Onder `/tool/api/*`; `requirePermission` per route; Zod-validatie van body, query en params.
- Fouten via `AppError` met stabiele code; nooit stacktraces of interne details naar de client.
- Whitelist velden bij create/update (geen mass assignment); paginering met maximale paginagrootte.
- Body-limiet klein houden; uploads en webhooks krijgen eigen, aangepaste limieten.
- Documenteer endpoints in `docs/api/`.
