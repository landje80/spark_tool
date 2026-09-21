---
name: prepare-deploy
description: Bereid een live deployment voor: checks, back-up, migratiebeoordeling, tag, rollbackplan.
---

1. npm run verify moet groen zijn (anders STOP).
2. npm run deploy:check op de doelomgeving; controleer .env.example vs Plesk-variabelen.
3. Beoordeel migraties op destructiviteit en rollbackcompatibiliteit; back-up bevestigen.
4. Laat deployment-reviewer reviewen; werk CHANGELOG bij; maak git tag vX.Y.Z.
5. Geef de Plesk-stappen uit docs/deployment/plesk-deployment.md en het rollbackplan. Deploy zelf niet.
