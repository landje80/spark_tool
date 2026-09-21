-- CreateTable
CREATE TABLE `User` (
    `id` VARCHAR(191) NOT NULL,
    `entraOid` VARCHAR(64) NOT NULL,
    `tenantId` VARCHAR(64) NOT NULL,
    `name` VARCHAR(200) NOT NULL,
    `email` VARCHAR(320) NOT NULL,
    `role` ENUM('ADMIN', 'MANAGER', 'SALES', 'CONTENT_EDITOR', 'VIEWER') NOT NULL DEFAULT 'VIEWER',
    `active` BOOLEAN NOT NULL DEFAULT true,
    `lastLoginAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `User_entraOid_key`(`entraOid`),
    UNIQUE INDEX `User_email_key`(`email`),
    INDEX `User_role_active_idx`(`role`, `active`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `RolePermission` (
    `role` ENUM('ADMIN', 'MANAGER', 'SALES', 'CONTENT_EDITOR', 'VIEWER') NOT NULL,
    `permission` VARCHAR(64) NOT NULL,

    PRIMARY KEY (`role`, `permission`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Session` (
    `id` VARCHAR(64) NOT NULL,
    `userId` VARCHAR(191) NULL,
    `data` JSON NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Session_expiresAt_idx`(`expiresAt`),
    INDEX `Session_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AppSetting` (
    `key` VARCHAR(100) NOT NULL,
    `value` JSON NOT NULL,
    `updatedBy` VARCHAR(191) NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Prospect` (
    `id` VARCHAR(191) NOT NULL,
    `companyName` VARCHAR(300) NOT NULL,
    `normalizedName` VARCHAR(300) NOT NULL,
    `website` VARCHAR(500) NULL,
    `domain` VARCHAR(255) NULL,
    `phone` VARCHAR(40) NULL,
    `kvkNumber` VARCHAR(8) NULL,
    `city` VARCHAR(120) NULL,
    `province` ENUM('OVERIJSSEL', 'DRENTHE', 'GELDERLAND', 'FLEVOLAND', 'OTHER') NOT NULL DEFAULT 'OTHER',
    `industry` VARCHAR(120) NULL,
    `employeesMin` INTEGER NULL,
    `employeesMax` INTEGER NULL,
    `employeesRationale` TEXT NULL,
    `employeesSourceUrl` VARCHAR(1000) NULL,
    `fitScore` INTEGER NULL,
    `fitRationale` TEXT NULL,
    `outreachAngle` TEXT NULL,
    `confidence` ENUM('LOW', 'MEDIUM', 'HIGH') NULL,
    `contactEmail` VARCHAR(320) NULL,
    `status` ENUM('NEW', 'IN_REVIEW', 'OUTREACH_PREPARED', 'EMAILED', 'REPLY_RECEIVED', 'REPLY_NOT_INTERESTED', 'CALLED', 'FOLLOW_UP', 'QUALIFIED', 'NOT_INTERESTED', 'CUSTOMER', 'ARCHIVED', 'INVALID', 'DUPLICATE') NOT NULL DEFAULT 'NEW',
    `ownerId` VARCHAR(191) NULL,
    `nextActionAt` DATETIME(3) NULL,
    `notInterestedReason` TEXT NULL,
    `notes` TEXT NULL,
    `firstFoundAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `lastVerifiedAt` DATETIME(3) NULL,
    `foundByRunId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `archivedAt` DATETIME(3) NULL,
    `anonymizedAt` DATETIME(3) NULL,

    UNIQUE INDEX `Prospect_domain_key`(`domain`),
    UNIQUE INDEX `Prospect_kvkNumber_key`(`kvkNumber`),
    INDEX `Prospect_status_ownerId_idx`(`status`, `ownerId`),
    INDEX `Prospect_nextActionAt_idx`(`nextActionAt`),
    INDEX `Prospect_province_city_idx`(`province`, `city`),
    INDEX `Prospect_industry_idx`(`industry`),
    INDEX `Prospect_createdAt_idx`(`createdAt`),
    INDEX `Prospect_normalizedName_idx`(`normalizedName`),
    UNIQUE INDEX `Prospect_normalizedName_city_key`(`normalizedName`, `city`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ProspectSource` (
    `id` VARCHAR(191) NOT NULL,
    `prospectId` VARCHAR(191) NOT NULL,
    `type` ENUM('WEBSITE', 'LINKEDIN', 'FACEBOOK', 'INSTAGRAM', 'TIKTOK', 'DIRECTORY', 'NEWS', 'OTHER') NOT NULL,
    `url` VARCHAR(1000) NOT NULL,
    `title` VARCHAR(300) NULL,
    `checkedAt` DATETIME(3) NOT NULL,
    `observation` TEXT NULL,
    `confidence` ENUM('LOW', 'MEDIUM', 'HIGH') NOT NULL DEFAULT 'MEDIUM',

    INDEX `ProspectSource_prospectId_idx`(`prospectId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SocialProfile` (
    `id` VARCHAR(191) NOT NULL,
    `prospectId` VARCHAR(191) NOT NULL,
    `platform` ENUM('LINKEDIN', 'FACEBOOK', 'INSTAGRAM', 'TIKTOK') NOT NULL,
    `url` VARCHAR(500) NOT NULL,
    `accountName` VARCHAR(200) NULL,
    `checkedAt` DATETIME(3) NULL,
    `observations` JSON NULL,

    INDEX `SocialProfile_prospectId_idx`(`prospectId`),
    UNIQUE INDEX `SocialProfile_url_key`(`url`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `LeadGenerationRun` (
    `id` VARCHAR(191) NOT NULL,
    `runKey` VARCHAR(100) NOT NULL,
    `startedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `finishedAt` DATETIME(3) NULL,
    `status` ENUM('PENDING', 'RUNNING', 'SUCCEEDED', 'PARTIAL', 'FAILED', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
    `model` VARCHAR(100) NULL,
    `promptVersionId` VARCHAR(191) NULL,
    `inputTokens` INTEGER NOT NULL DEFAULT 0,
    `outputTokens` INTEGER NOT NULL DEFAULT 0,
    `webSearchRequests` INTEGER NOT NULL DEFAULT 0,
    `estimatedCostUsd` DECIMAL(10, 4) NULL,
    `candidatesCount` INTEGER NOT NULL DEFAULT 0,
    `acceptedCount` INTEGER NOT NULL DEFAULT 0,
    `duplicateCount` INTEGER NOT NULL DEFAULT 0,
    `reviewCount` INTEGER NOT NULL DEFAULT 0,
    `errorMessage` TEXT NULL,
    `metadata` JSON NULL,

    UNIQUE INDEX `LeadGenerationRun_runKey_key`(`runKey`),
    INDEX `LeadGenerationRun_startedAt_idx`(`startedAt`),
    INDEX `LeadGenerationRun_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `LeadCandidate` (
    `id` VARCHAR(191) NOT NULL,
    `runId` VARCHAR(191) NOT NULL,
    `payload` JSON NOT NULL,
    `matchedProspectId` VARCHAR(191) NULL,
    `matchReason` VARCHAR(300) NULL,
    `status` ENUM('PENDING', 'ACCEPTED_AS_NEW', 'MERGED', 'REJECTED') NOT NULL DEFAULT 'PENDING',
    `reviewedBy` VARCHAR(191) NULL,
    `reviewedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `LeadCandidate_status_idx`(`status`),
    INDEX `LeadCandidate_runId_idx`(`runId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PromptVersion` (
    `id` VARCHAR(191) NOT NULL,
    `purpose` VARCHAR(60) NOT NULL,
    `version` INTEGER NOT NULL,
    `systemText` MEDIUMTEXT NOT NULL,
    `schemaJson` JSON NOT NULL,
    `sha256` VARCHAR(64) NOT NULL,
    `active` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `PromptVersion_purpose_active_idx`(`purpose`, `active`),
    UNIQUE INDEX `PromptVersion_purpose_version_key`(`purpose`, `version`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ProspectActivity` (
    `id` VARCHAR(191) NOT NULL,
    `prospectId` VARCHAR(191) NOT NULL,
    `type` ENUM('CREATED', 'STATUS_CHANGED', 'FIELD_CHANGED', 'NOTE', 'CALL', 'EMAIL_SENT', 'REPLY_RECEIVED', 'TASK_CREATED', 'MERGED', 'ARCHIVED', 'RESTORED', 'CONVERTED_TO_CUSTOMER', 'EXPORTED', 'ANONYMIZED') NOT NULL,
    `actorId` VARCHAR(191) NULL,
    `description` TEXT NULL,
    `oldValue` VARCHAR(500) NULL,
    `newValue` VARCHAR(500) NULL,
    `metadata` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ProspectActivity_prospectId_createdAt_idx`(`prospectId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `OutreachDraft` (
    `id` VARCHAR(191) NOT NULL,
    `prospectId` VARCHAR(191) NOT NULL,
    `subject` VARCHAR(300) NOT NULL,
    `htmlBody` MEDIUMTEXT NOT NULL,
    `textBody` MEDIUMTEXT NOT NULL,
    `openingLine` VARCHAR(500) NULL,
    `status` ENUM('DRAFT', 'APPROVED', 'SENT', 'DISCARDED') NOT NULL DEFAULT 'DRAFT',
    `generatedBy` VARCHAR(100) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `approvedById` VARCHAR(191) NULL,
    `approvedAt` DATETIME(3) NULL,

    INDEX `OutreachDraft_prospectId_status_idx`(`prospectId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `EmailMessage` (
    `id` VARCHAR(191) NOT NULL,
    `prospectId` VARCHAR(191) NULL,
    `draftId` VARCHAR(191) NULL,
    `idempotencyKey` VARCHAR(100) NOT NULL,
    `postmarkMessageId` VARCHAR(100) NULL,
    `fromEmail` VARCHAR(320) NOT NULL,
    `toEmail` VARCHAR(320) NOT NULL,
    `subject` VARCHAR(300) NOT NULL,
    `status` ENUM('QUEUED', 'SENT', 'DELIVERED', 'BOUNCED', 'SPAM_COMPLAINT', 'FAILED') NOT NULL DEFAULT 'QUEUED',
    `sentAt` DATETIME(3) NULL,
    `deliveredAt` DATETIME(3) NULL,
    `openedAt` DATETIME(3) NULL,
    `bounceType` VARCHAR(60) NULL,
    `bounceInfo` TEXT NULL,
    `metadata` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `EmailMessage_idempotencyKey_key`(`idempotencyKey`),
    UNIQUE INDEX `EmailMessage_postmarkMessageId_key`(`postmarkMessageId`),
    INDEX `EmailMessage_prospectId_idx`(`prospectId`),
    INDEX `EmailMessage_status_idx`(`status`),
    INDEX `EmailMessage_toEmail_idx`(`toEmail`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `EmailSuppression` (
    `id` VARCHAR(191) NOT NULL,
    `emailHash` VARCHAR(64) NOT NULL,
    `domain` VARCHAR(255) NULL,
    `reason` ENUM('OPT_OUT', 'HARD_BOUNCE', 'SPAM_COMPLAINT', 'MANUAL', 'DELETED_PROSPECT') NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `EmailSuppression_emailHash_key`(`emailHash`),
    INDEX `EmailSuppression_domain_idx`(`domain`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `WebhookEvent` (
    `id` VARCHAR(191) NOT NULL,
    `provider` VARCHAR(40) NOT NULL,
    `externalKey` VARCHAR(200) NOT NULL,
    `eventType` VARCHAR(60) NOT NULL,
    `payload` JSON NOT NULL,
    `receivedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `processedAt` DATETIME(3) NULL,
    `error` TEXT NULL,

    UNIQUE INDEX `WebhookEvent_externalKey_key`(`externalKey`),
    INDEX `WebhookEvent_provider_eventType_idx`(`provider`, `eventType`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Task` (
    `id` VARCHAR(191) NOT NULL,
    `prospectId` VARCHAR(191) NULL,
    `type` ENUM('CALL', 'EMAIL', 'FOLLOW_UP', 'REVIEW', 'OTHER') NOT NULL DEFAULT 'FOLLOW_UP',
    `assigneeId` VARCHAR(191) NULL,
    `dueAt` DATETIME(3) NULL,
    `priority` ENUM('LOW', 'NORMAL', 'HIGH') NOT NULL DEFAULT 'NORMAL',
    `status` ENUM('OPEN', 'DONE', 'CANCELLED') NOT NULL DEFAULT 'OPEN',
    `description` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Task_assigneeId_status_dueAt_idx`(`assigneeId`, `status`, `dueAt`),
    INDEX `Task_prospectId_idx`(`prospectId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AuditLog` (
    `id` VARCHAR(191) NOT NULL,
    `actorId` VARCHAR(191) NULL,
    `action` VARCHAR(100) NOT NULL,
    `entityType` VARCHAR(60) NOT NULL,
    `entityId` VARCHAR(64) NULL,
    `ip` VARCHAR(64) NULL,
    `metadata` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `AuditLog_entityType_entityId_idx`(`entityType`, `entityId`),
    INDEX `AuditLog_actorId_createdAt_idx`(`actorId`, `createdAt`),
    INDEX `AuditLog_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Job` (
    `id` VARCHAR(191) NOT NULL,
    `type` VARCHAR(60) NOT NULL,
    `dedupeKey` VARCHAR(120) NULL,
    `payload` JSON NULL,
    `status` ENUM('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'DEAD') NOT NULL DEFAULT 'PENDING',
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `maxAttempts` INTEGER NOT NULL DEFAULT 5,
    `runAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `lockedAt` DATETIME(3) NULL,
    `lockedBy` VARCHAR(80) NULL,
    `lastError` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `finishedAt` DATETIME(3) NULL,

    INDEX `Job_status_runAt_idx`(`status`, `runAt`),
    UNIQUE INDEX `Job_type_dedupeKey_key`(`type`, `dedupeKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Customer` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(300) NOT NULL,
    `prospectId` VARCHAR(191) NULL,
    `contactName` VARCHAR(200) NULL,
    `contactEmail` VARCHAR(320) NULL,
    `status` ENUM('ONBOARDING', 'ACTIVE', 'PAUSED', 'ENDED') NOT NULL DEFAULT 'ONBOARDING',
    `allowedPlatforms` JSON NOT NULL,
    `storageSettings` JSON NULL,
    `defaultTone` TEXT NULL,
    `approvalWorkflow` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Customer_prospectId_key`(`prospectId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `BrandProfile` (
    `id` VARCHAR(191) NOT NULL,
    `customerId` VARCHAR(191) NOT NULL,
    `version` INTEGER NOT NULL,
    `data` JSON NOT NULL,
    `active` BOOLEAN NOT NULL DEFAULT false,
    `createdBy` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `BrandProfile_customerId_version_key`(`customerId`, `version`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `UploadLink` (
    `id` VARCHAR(191) NOT NULL,
    `customerId` VARCHAR(191) NOT NULL,
    `tokenHash` VARCHAR(64) NOT NULL,
    `campaign` VARCHAR(200) NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `maxUses` INTEGER NULL,
    `useCount` INTEGER NOT NULL DEFAULT 0,
    `revokedAt` DATETIME(3) NULL,
    `createdBy` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `UploadLink_tokenHash_key`(`tokenHash`),
    INDEX `UploadLink_customerId_idx`(`customerId`),
    INDEX `UploadLink_expiresAt_idx`(`expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ContentSubmission` (
    `id` VARCHAR(191) NOT NULL,
    `customerId` VARCHAR(191) NOT NULL,
    `uploadLinkId` VARCHAR(191) NULL,
    `status` ENUM('RECEIVED', 'TECHNICAL_CHECK', 'PROCESSING', 'DRAFT_READY', 'IN_REVIEW', 'CHANGES_REQUESTED', 'APPROVED', 'READY_TO_PUBLISH', 'PUBLISHED', 'ARCHIVED', 'FAILED') NOT NULL DEFAULT 'RECEIVED',
    `note` TEXT NULL,
    `topic` VARCHAR(120) NULL,
    `consentAt` DATETIME(3) NOT NULL,
    `brandVersionId` VARCHAR(191) NULL,
    `failureReason` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ContentSubmission_customerId_status_idx`(`customerId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MediaAsset` (
    `id` VARCHAR(191) NOT NULL,
    `submissionId` VARCHAR(191) NOT NULL,
    `parentId` VARCHAR(191) NULL,
    `role` ENUM('ORIGINAL', 'DERIVATIVE', 'THUMBNAIL') NOT NULL,
    `kind` ENUM('IMAGE', 'VIDEO') NOT NULL,
    `storageKey` VARCHAR(200) NOT NULL,
    `originalName` VARCHAR(255) NULL,
    `mimeType` VARCHAR(100) NOT NULL,
    `sizeBytes` BIGINT NOT NULL,
    `sha256` VARCHAR(64) NOT NULL,
    `width` INTEGER NULL,
    `height` INTEGER NULL,
    `durationSec` DECIMAL(8, 2) NULL,
    `variant` VARCHAR(60) NULL,
    `scanStatus` ENUM('PENDING', 'CLEAN', 'INFECTED', 'SKIPPED', 'ERROR') NOT NULL DEFAULT 'PENDING',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `MediaAsset_storageKey_key`(`storageKey`),
    INDEX `MediaAsset_submissionId_role_idx`(`submissionId`, `role`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ContentConcept` (
    `id` VARCHAR(191) NOT NULL,
    `submissionId` VARCHAR(191) NOT NULL,
    `version` INTEGER NOT NULL,
    `summary` TEXT NULL,
    `missingContext` JSON NULL,
    `model` VARCHAR(100) NULL,
    `promptVersionId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `ContentConcept_submissionId_version_key`(`submissionId`, `version`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PublicationDraft` (
    `id` VARCHAR(191) NOT NULL,
    `submissionId` VARCHAR(191) NOT NULL,
    `platform` ENUM('LINKEDIN', 'FACEBOOK', 'INSTAGRAM', 'TIKTOK') NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `text` TEXT NOT NULL,
    `hashtags` JSON NULL,
    `cta` VARCHAR(300) NULL,
    `format` VARCHAR(60) NULL,
    `mediaAssetId` VARCHAR(191) NULL,
    `aspectRatio` VARCHAR(20) NULL,
    `resolution` VARCHAR(20) NULL,
    `durationSec` INTEGER NULL,
    `altText` TEXT NULL,
    `status` ENUM('DRAFT', 'IN_REVIEW', 'CHANGES_REQUESTED', 'APPROVED', 'PUBLISHED', 'DISCARDED') NOT NULL DEFAULT 'DRAFT',
    `reviewerId` VARCHAR(191) NULL,
    `feedback` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `PublicationDraft_submissionId_platform_version_idx`(`submissionId`, `platform`, `version`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Prospect` ADD CONSTRAINT `Prospect_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Prospect` ADD CONSTRAINT `Prospect_foundByRunId_fkey` FOREIGN KEY (`foundByRunId`) REFERENCES `LeadGenerationRun`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProspectSource` ADD CONSTRAINT `ProspectSource_prospectId_fkey` FOREIGN KEY (`prospectId`) REFERENCES `Prospect`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SocialProfile` ADD CONSTRAINT `SocialProfile_prospectId_fkey` FOREIGN KEY (`prospectId`) REFERENCES `Prospect`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LeadGenerationRun` ADD CONSTRAINT `LeadGenerationRun_promptVersionId_fkey` FOREIGN KEY (`promptVersionId`) REFERENCES `PromptVersion`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LeadCandidate` ADD CONSTRAINT `LeadCandidate_runId_fkey` FOREIGN KEY (`runId`) REFERENCES `LeadGenerationRun`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProspectActivity` ADD CONSTRAINT `ProspectActivity_prospectId_fkey` FOREIGN KEY (`prospectId`) REFERENCES `Prospect`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProspectActivity` ADD CONSTRAINT `ProspectActivity_actorId_fkey` FOREIGN KEY (`actorId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `OutreachDraft` ADD CONSTRAINT `OutreachDraft_prospectId_fkey` FOREIGN KEY (`prospectId`) REFERENCES `Prospect`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `OutreachDraft` ADD CONSTRAINT `OutreachDraft_approvedById_fkey` FOREIGN KEY (`approvedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `EmailMessage` ADD CONSTRAINT `EmailMessage_prospectId_fkey` FOREIGN KEY (`prospectId`) REFERENCES `Prospect`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `EmailMessage` ADD CONSTRAINT `EmailMessage_draftId_fkey` FOREIGN KEY (`draftId`) REFERENCES `OutreachDraft`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Task` ADD CONSTRAINT `Task_prospectId_fkey` FOREIGN KEY (`prospectId`) REFERENCES `Prospect`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Task` ADD CONSTRAINT `Task_assigneeId_fkey` FOREIGN KEY (`assigneeId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AuditLog` ADD CONSTRAINT `AuditLog_actorId_fkey` FOREIGN KEY (`actorId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Customer` ADD CONSTRAINT `Customer_prospectId_fkey` FOREIGN KEY (`prospectId`) REFERENCES `Prospect`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `BrandProfile` ADD CONSTRAINT `BrandProfile_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `Customer`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `UploadLink` ADD CONSTRAINT `UploadLink_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `Customer`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ContentSubmission` ADD CONSTRAINT `ContentSubmission_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `Customer`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ContentSubmission` ADD CONSTRAINT `ContentSubmission_uploadLinkId_fkey` FOREIGN KEY (`uploadLinkId`) REFERENCES `UploadLink`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MediaAsset` ADD CONSTRAINT `MediaAsset_submissionId_fkey` FOREIGN KEY (`submissionId`) REFERENCES `ContentSubmission`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MediaAsset` ADD CONSTRAINT `MediaAsset_parentId_fkey` FOREIGN KEY (`parentId`) REFERENCES `MediaAsset`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ContentConcept` ADD CONSTRAINT `ContentConcept_submissionId_fkey` FOREIGN KEY (`submissionId`) REFERENCES `ContentSubmission`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PublicationDraft` ADD CONSTRAINT `PublicationDraft_submissionId_fkey` FOREIGN KEY (`submissionId`) REFERENCES `ContentSubmission`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

