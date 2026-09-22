-- Fase I eindcontrole: ontbrekende foreign keys, ontbrekende/overbodige indexen (bevindingen van de
-- database-reviewer). Tabelnamen zijn hier handmatig gecontroleerd op PascalCase (de gegenereerde
-- diff bevatte weer de bekende Windows/MariaDB-valkuil: `ON \`leadcandidate\`` i.p.v. `LeadCandidate`).

-- Nooit gedropt toen `email_indexes` de losse index verving door de samengestelde
-- (prospectId, toEmail)-index; overbodig sinds toen, nu opgeruimd.
DROP INDEX `EmailMessage_prospectId_idx` ON `EmailMessage`;

-- CreateIndex
DROP INDEX `LeadCandidate_status_idx` ON `LeadCandidate`;
CREATE INDEX `LeadCandidate_status_createdAt_idx` ON `LeadCandidate`(`status`, `createdAt`);

-- CreateIndex
CREATE INDEX `Prospect_contactEmail_idx` ON `Prospect`(`contactEmail`);

-- AddForeignKey
ALTER TABLE `Session` ADD CONSTRAINT `Session_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AppSetting` ADD CONSTRAINT `AppSetting_updatedBy_fkey` FOREIGN KEY (`updatedBy`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LeadCandidate` ADD CONSTRAINT `LeadCandidate_matchedProspectId_fkey` FOREIGN KEY (`matchedProspectId`) REFERENCES `Prospect`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
