-- CreateIndex
CREATE INDEX `EmailMessage_prospectId_toEmail_idx` ON `EmailMessage`(`prospectId`, `toEmail`);

-- CreateIndex
CREATE INDEX `EmailMessage_createdAt_status_idx` ON `EmailMessage`(`createdAt`, `status`);

