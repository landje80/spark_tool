# Databasemodel

Bron van waarheid: `prisma/schema.prisma`. Migraties in `prisma/migrations/` (Git). Geen handmatige schemawijzigingen in productie.

## Groepen

| Groep           | Tabellen                                                                                                                    |
| --------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Identiteit      | `User`, `RolePermission`, `Session`, `AppSetting`                                                                           |
| CRM             | `Prospect`, `ProspectSource`, `SocialProfile`, `ProspectActivity`, `Task`                                                   |
| Leadgeneratie   | `LeadGenerationRun`, `LeadCandidate` (reviewqueue fuzzy matches), `PromptVersion`                                           |
| Outreach        | `OutreachDraft`, `EmailMessage`, `EmailSuppression`, `WebhookEvent`                                                         |
| Klanten/content | `Customer`, `BrandProfile` (versies), `UploadLink`, `ContentSubmission`, `MediaAsset`, `ContentConcept`, `PublicationDraft` |
| Platform        | `Job`, `AuditLog`                                                                                                           |

## Belangrijke ontwerpkeuzes

- **Stabiele enums** (`ProspectStatus`, …) intern; Nederlandse labels in `shared/i18n/nl.ts`.
- **Deduplicatie in de database:** unieke `Prospect.domain`, `kvkNumber`, `(normalizedName, city)` en `SocialProfile.url`. Fuzzy matches worden nooit automatisch samengevoegd maar komen in `LeadCandidate`.
- **Idempotentie:** `LeadGenerationRun.runKey` (bv. datum), `EmailMessage.idempotencyKey`, `WebhookEvent.externalKey`, `Job(type, dedupeKey)`.
- **Suppressie overleeft verwijdering:** `EmailSuppression` bewaart alleen een SHA-256-hash van het adres.
- **Tokens gehasht:** `UploadLink.tokenHash`; sessies bewaren hash van sessie-id.
- **Origineel onveranderlijk:** `MediaAsset` met `role` ORIGINAL/DERIVATIVE/THUMBNAIL en `parentId`; afgeleiden zijn aparte rijen. `onDelete: Restrict` op `parentId`.
- **Soft delete/anonimisering:** `Prospect.archivedAt`, `anonymizedAt`.
- **Versies:** `BrandProfile(customerId, version)`, `PromptVersion(purpose, version)`, `ContentConcept(submissionId, version)`.
- **Cascade:** bronnen, activiteiten, taken, drafts verdwijnen mee met een prospect; `EmailMessage.prospectId` wordt `SetNull` zodat verzendhistorie bewaard kan blijven.

## MariaDB-specifiek

- **Tabelnamen zijn op Linux hoofdlettergevoelig, op Windows niet.** `prisma migrate diff` op een Windows-dev-database levert tabelnamen in kleine letters (bijvoorbeeld `ON prospect` in plaats van `ON Prospect`). Controleer elke gegenereerde migratie en zet ze terug naar de modelnaam (`Prospect`). Gebeurd bij `20260921120000_indexes`.
- `JSON` is bij MariaDB een alias voor `LONGTEXT`; Prisma leest en schrijft dit als object (getest voor `Session.data`).
- Named locks (`GET_LOCK`) serialiseren duplicaatcontrole + insert (zie `src/shared/database/lock.ts`).

## Migratieprocedure

1. Wijzig `schema.prisma`.
2. `npx prisma migrate dev --name <naam>` (lokale MySQL) of `migrate diff --script`.
3. Beoordeel de SQL op destructieve statements (`DROP`, kolomverkleining). Destructief → expand/contract in meerdere releases. Een nieuwe `ADD CONSTRAINT ... FOREIGN KEY` faalt hard als er al rijen bestaan met een waarde die naar niets (meer) verwijst; controleer dat vooraf op een productie-achtige dataset, niet alleen op een lege dev-database.
4. `npm run db:backup`, daarna `npm run db:migrate` (`prisma migrate deploy`).

De initiële migratie `20260921000000_init` is gegenereerd met `prisma migrate diff` en op 2026-09-21 succesvol toegepast op een lokale **MariaDB 11.8.2**: 26 tabellen, geen schema-drift, seed geslaagd. De productieserver draait MariaDB; de exacte serverversie moet nog worden vergeleken met 11.8.

`20260922150000_content_fk_hardening` (Fase G) voegt de foreign keys toe die bij de fundering nog ontbraken: `LeadCandidate.reviewedBy`, `BrandProfile.createdBy`, `UploadLink.createdBy`, `ContentConcept.promptVersionId`, `PublicationDraft.mediaAssetId` en `PublicationDraft.reviewerId` (alle `ON DELETE SET NULL`, zoals de overige `*By`-kolommen).
