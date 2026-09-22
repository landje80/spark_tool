-- CreateIndex
CREATE INDEX `ContentSubmission_status_updatedAt_idx` ON `ContentSubmission`(`status`, `updatedAt`);

-- CreateIndex
CREATE INDEX `Customer_status_idx` ON `Customer`(`status`);
