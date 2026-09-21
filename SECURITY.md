# Securitybeleid

Meld kwetsbaarheden vertrouwelijk aan j.land@niceracing.nl (geen publieke issues). Geef stappen om te reproduceren; verwacht een reactie binnen 5 werkdagen. Secrets nooit in issues of commits plaatsen; bij lekken direct roteren.

Dependency-beleid: `npm run audit:deps` in `npm run verify`; upgrades via de skill `dependency-upgrade`; high/critical binnen 7 dagen oplossen of gedocumenteerd accepteren (ADR).
