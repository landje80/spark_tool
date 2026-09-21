---
paths:
  - 'src/modules/auth/**'
  - 'src/integrations/microsoft/**'
  - 'src/shared/security/**'
---

# Authenticatie en autorisatie

- Single-tenant authority; valideer tid, aud, iss, nonce en state; PKCE blijft aan.
- Default deny: toegang vereist allowlist (gebruikers-ID of groep). Wijzig `evaluateAccess` alleen met tests.
- Sessie roteren na login; sessie-id nooit loggen; cookies HttpOnly/Secure/SameSite.
- `returnTo` alleen via `safeReturnTo`.
- Nieuwe permissie: toevoegen in `permissions.ts`, seed, docs en tests.
