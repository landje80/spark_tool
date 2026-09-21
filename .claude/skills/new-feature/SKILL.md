---
name: new-feature
description: Implementeer een nieuwe feature in Spark Tool volgens de vaste workflow (schema, service, API, UI, tests, docs).
---

1. Lees relevante docs en rules; controleer of de feature past in docs/product-requirements.md.
2. Ontwerp: datamodel, permissies, endpoints, UI-teksten (nl.ts). Kies conventionele keuzes; noteer ADR indien nodig.
3. Bouw domeinlogica puur en test die eerst; daarna service, API (Zod + requirePermission), UI (mobile first, WCAG).
4. Gebruik skill database-change bij schemawijzigingen; werk .env.example bij nieuwe variabelen bij.
5. Draai npm run verify; los alles op. Roep reviewer-subagents aan bij substantiële wijzigingen en verwerk bevindingen.
6. Werk docs bij (system-design status, api docs, changelog).
