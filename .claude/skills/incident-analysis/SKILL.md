---
name: incident-analysis
description: Analyseer een incident in productie systematisch.
---

1. Verzamel requestId, tijdstip, symptoom. 2. Zoek in logs (JSON, redacted) en AuditLog. 3. Controleer /tool/health, Job-status (DEAD), integratiestatus. 4. Formuleer oorzaakhypothese, verifieer, herstel (rollback volgens plesk-deployment.md indien nodig). 5. Schrijf korte post-mortem in docs/operations en voeg test of monitoring toe. Toon nooit secrets.
