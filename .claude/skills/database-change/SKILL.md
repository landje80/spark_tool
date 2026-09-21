---
name: database-change
description: Voer een databasewijziging veilig uit: schema, migratie, back-up, rollbackroute.
---

1. Wijzig prisma/schema.prisma; npx prisma validate.
2. Genereer migratie (migrate dev of migrate diff --script); lees de SQL.
3. Destructief (DROP/kolomverkleining/NOT NULL zonder default)? Gebruik expand/contract; nooit zonder herstelroute.
4. Update docs/architecture/database-model.md en seed indien nodig; laat database-reviewer reviewen.
5. Productie: npm run db:backup, dan npm run db:migrate; documenteer rollback (back-up herstellen of compatibele vorige release).
