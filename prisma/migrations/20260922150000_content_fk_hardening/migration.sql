-- AddForeignKey
ALTER TABLE `LeadCandidate` ADD CONSTRAINT `LeadCandidate_reviewedBy_fkey` FOREIGN KEY (`reviewedBy`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `BrandProfile` ADD CONSTRAINT `BrandProfile_createdBy_fkey` FOREIGN KEY (`createdBy`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `UploadLink` ADD CONSTRAINT `UploadLink_createdBy_fkey` FOREIGN KEY (`createdBy`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ContentConcept` ADD CONSTRAINT `ContentConcept_promptVersionId_fkey` FOREIGN KEY (`promptVersionId`) REFERENCES `PromptVersion`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PublicationDraft` ADD CONSTRAINT `PublicationDraft_mediaAssetId_fkey` FOREIGN KEY (`mediaAssetId`) REFERENCES `MediaAsset`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PublicationDraft` ADD CONSTRAINT `PublicationDraft_reviewerId_fkey` FOREIGN KEY (`reviewerId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
