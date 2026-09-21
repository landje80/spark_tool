---
name: dependency-upgrade
description: Voer een dependency-upgrade gecontroleerd uit.
---

1. npm outdated + npm audit; lees changelogs van major upgrades.
2. Controleer onderlinge compatibiliteit (TypeScript vs typescript-eslint, Prisma vs Node, Vite vs plugins).
3. Upgrade één groep per keer; npm run verify na elke stap.
4. Werk docs/architecture/technology-decisions.md bij (datum, reden) en de audit-allowlist indien nodig.
