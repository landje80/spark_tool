---
paths:
  - 'prisma/**'
  - 'src/shared/database/**'
---

# Database en migraties

- Schema alleen wijzigen via `prisma/schema.prisma` + migratie; nooit handmatig in productie.
- Controleer elke migratie op `DROP`/kolomverkleining: gebruik expand/contract over meerdere releases.
- Back-up (`npm run db:backup`) vóór `db:migrate`; rollbackcompatibiliteit beoordelen en documenteren.
- Uniekheid en idempotentie in de database afdwingen (unieke keys), niet alleen in code.
- E-mailverzending en statuswijzigingen in één transactie met activiteit + audit.
- Controleer gegenereerde migratie-SQL op kleine-letter tabelnamen (Windows-dev) en corrigeer naar de modelnaam; productie is Linux (hoofdlettergevoelig).
- Seeds bevatten nooit echte persoonsgegevens.
