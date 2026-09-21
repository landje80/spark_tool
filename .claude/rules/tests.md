---
paths:
  - '**/*.test.ts'
  - '**/*.test.tsx'
---

# Tests

- Unit: `*.test.ts`; integratie: `*.integration.test.ts` (Vitest projects).
- Mock Postmark en Anthropic; gebruik synthetische fixtures; nooit de productiedatabase.
- Test gedrag en randgevallen (autorisatie-weigering, idempotency, ongeldige AI-output), niet implementatiedetails.
