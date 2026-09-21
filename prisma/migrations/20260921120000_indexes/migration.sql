-- DropIndex
DROP INDEX `Prospect_normalizedName_idx` ON `Prospect`;

-- CreateIndex
CREATE INDEX `EmailMessage_sentAt_idx` ON `EmailMessage`(`sentAt`);

-- CreateIndex
CREATE INDEX `Prospect_city_idx` ON `Prospect`(`city`);

-- CreateIndex
CREATE INDEX `Prospect_archivedAt_idx` ON `Prospect`(`archivedAt`);

-- CreateIndex
CREATE INDEX `Task_status_dueAt_idx` ON `Task`(`status`, `dueAt`);

