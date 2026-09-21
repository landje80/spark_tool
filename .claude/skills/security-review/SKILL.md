---
name: security-review
description: Voer een securityreview uit op de wijzigingen of het hele project.
---

Controleer: authenticatie/tenant/nonce/state, autorisatie per endpoint, CSRF, XSS/CSP, input-validatie, mass assignment, rate limits, secrets in code/logs, upload- en SSRF-risico's, webhookauthenticatie, dependency-audit (npm run audit:deps), foutafhandeling (geen stacktraces). Gebruik subagent security-reviewer. Rapporteer bevindingen met ernst, bestand:regel en fix; verwerk kritieke/hoge direct en draai verify opnieuw.
