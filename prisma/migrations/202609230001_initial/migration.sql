CREATE TABLE `Role` (
 `id` VARCHAR(191) NOT NULL, `name` VARCHAR(100) NOT NULL,
 `description` VARCHAR(191) NOT NULL DEFAULT '', `enabled` BOOLEAN NOT NULL DEFAULT true,
 `builtIn` BOOLEAN NOT NULL DEFAULT false, `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 `updatedAt` DATETIME(3) NOT NULL, UNIQUE INDEX `Role_name_key` (`name`), PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE TABLE `User` (
 `id` VARCHAR(191) NOT NULL, `username` VARCHAR(100) NOT NULL, `passwordHash` VARCHAR(255) NOT NULL,
 `enabled` BOOLEAN NOT NULL DEFAULT true, `forceChangePassword` BOOLEAN NOT NULL DEFAULT true,
 `tokenVersion` INTEGER NOT NULL DEFAULT 0, `roleId` VARCHAR(191) NOT NULL,
 `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), `updatedAt` DATETIME(3) NOT NULL,
 UNIQUE INDEX `User_username_key` (`username`), PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE TABLE `Permission` (
 `id` VARCHAR(191) NOT NULL, `description` VARCHAR(191) NOT NULL, PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE TABLE `RolePermission` (
 `roleId` VARCHAR(191) NOT NULL, `permissionId` VARCHAR(191) NOT NULL, PRIMARY KEY (`roleId`, `permissionId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE TABLE `RefreshSession` (
 `id` VARCHAR(191) NOT NULL, `userId` VARCHAR(191) NOT NULL, `tokenHash` CHAR(64) NOT NULL,
 `familyId` VARCHAR(191) NOT NULL, `expiresAt` DATETIME(3) NOT NULL, `revokedAt` DATETIME(3) NULL,
 `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 UNIQUE INDEX `RefreshSession_tokenHash_key` (`tokenHash`), INDEX `RefreshSession_userId_familyId_idx` (`userId`, `familyId`), PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE TABLE `AuditLog` (
 `id` VARCHAR(191) NOT NULL, `userId` VARCHAR(191) NULL, `action` VARCHAR(191) NOT NULL,
 `targetId` VARCHAR(191) NULL, `metadata` JSON NULL, `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 INDEX `AuditLog_createdAt_idx` (`createdAt`), PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE TABLE `Pipeline` (
 `id` VARCHAR(191) NOT NULL, `name` VARCHAR(191) NOT NULL, `kind` VARCHAR(191) NOT NULL,
 `version` VARCHAR(191) NOT NULL DEFAULT '1', `enabled` BOOLEAN NOT NULL DEFAULT true, `metadata` JSON NULL,
 `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), `updatedAt` DATETIME(3) NOT NULL, PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE TABLE `Task` (
 `id` VARCHAR(191) NOT NULL, `userId` VARCHAR(191) NOT NULL, `title` VARCHAR(191) NOT NULL,
 `kind` VARCHAR(191) NOT NULL DEFAULT 'video', `status` VARCHAR(191) NOT NULL DEFAULT 'QUEUED',
 `progress` DOUBLE NOT NULL DEFAULT 0, `stageIndex` INTEGER NOT NULL DEFAULT 0,
 `stages` JSON NOT NULL, `request` JSON NOT NULL, `metadata` JSON NULL,
 `modelId` VARCHAR(191) NULL, `workflowId` VARCHAR(191) NULL, `pipelineId` VARCHAR(191) NULL,
 `script` LONGTEXT NOT NULL, `previousScript` LONGTEXT NOT NULL, `characters` JSON NOT NULL,
 `shots` JSON NOT NULL, `quality` JSON NULL, `logs` JSON NOT NULL, `cover` VARCHAR(191) NOT NULL DEFAULT '',
 `elapsed` INTEGER NOT NULL DEFAULT 0, `estimated` INTEGER NOT NULL DEFAULT 0,
 `retries` INTEGER NOT NULL DEFAULT 0, `approved` BOOLEAN NOT NULL DEFAULT false, `error` TEXT NULL,
 `isPublic` BOOLEAN NOT NULL DEFAULT false, `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 `updatedAt` DATETIME(3) NOT NULL, INDEX `Task_userId_createdAt_idx` (`userId`, `createdAt`), PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE TABLE `AIService` (
 `id` VARCHAR(191) NOT NULL, `name` VARCHAR(191) NOT NULL, `kind` ENUM('COMFYUI', 'OPENAI', 'OLLAMA') NOT NULL,
 `baseUrl` VARCHAR(191) NOT NULL, `enabled` BOOLEAN NOT NULL DEFAULT true, `secretEncrypted` TEXT NULL,
 `health` JSON NULL, `metadata` JSON NULL, `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 `updatedAt` DATETIME(3) NOT NULL, PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE TABLE `AIModel` (
 `id` VARCHAR(191) NOT NULL, `serviceId` VARCHAR(191) NOT NULL, `remoteId` VARCHAR(191) NOT NULL,
 `name` VARCHAR(191) NOT NULL, `enabled` BOOLEAN NOT NULL DEFAULT true, `metadata` JSON NULL,
 `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), `updatedAt` DATETIME(3) NOT NULL,
 UNIQUE INDEX `AIModel_serviceId_remoteId_key` (`serviceId`, `remoteId`), PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE TABLE `Workflow` (
 `id` VARCHAR(191) NOT NULL, `name` VARCHAR(191) NOT NULL, `description` TEXT NOT NULL,
 `provider` VARCHAR(191) NOT NULL, `type` VARCHAR(191) NOT NULL, `instanceId` VARCHAR(191) NULL,
 `status` VARCHAR(191) NOT NULL DEFAULT 'DRAFT', `version` VARCHAR(191) NOT NULL DEFAULT '1',
 `workflowJson` JSON NULL, `apiWorkflowJson` JSON NULL, `mapping` JSON NULL, `metadata` JSON NULL,
 `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), `updatedAt` DATETIME(3) NOT NULL, PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE TABLE `WorkflowVersion` (
 `id` VARCHAR(191) NOT NULL, `workflowId` VARCHAR(191) NOT NULL, `version` VARCHAR(191) NOT NULL,
 `workflowJson` JSON NULL, `apiWorkflowJson` JSON NULL, `mapping` JSON NULL, `metadata` JSON NULL,
 `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 UNIQUE INDEX `WorkflowVersion_workflowId_version_key` (`workflowId`, `version`), PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE TABLE `Execution` (
 `id` VARCHAR(191) NOT NULL, `taskId` VARCHAR(191) NOT NULL, `userId` VARCHAR(191) NOT NULL,
 `provider` VARCHAR(191) NOT NULL, `serviceId` VARCHAR(191) NULL, `workflowId` VARCHAR(191) NULL,
 `workflowVersion` VARCHAR(191) NULL, `modelId` VARCHAR(191) NULL, `promptId` VARCHAR(191) NULL,
 `status` VARCHAR(191) NOT NULL DEFAULT 'QUEUED', `progress` DOUBLE NULL DEFAULT 0,
 `input` JSON NOT NULL, `output` JSON NULL, `error` JSON NULL, `metadata` JSON NULL,
 `startedAt` DATETIME(3) NULL, `finishedAt` DATETIME(3) NULL,
 `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), `updatedAt` DATETIME(3) NOT NULL,
 INDEX `Execution_userId_createdAt_idx` (`userId`, `createdAt`), INDEX `Execution_status_idx` (`status`), PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE TABLE `Asset` (
 `id` VARCHAR(191) NOT NULL, `userId` VARCHAR(191) NOT NULL, `taskId` VARCHAR(191) NULL,
 `executionId` VARCHAR(191) NULL, `name` VARCHAR(191) NOT NULL, `type` VARCHAR(191) NOT NULL,
 `mimeType` VARCHAR(191) NULL, `storagePath` TEXT NULL, `metadata` JSON NOT NULL,
 `isPublic` BOOLEAN NOT NULL DEFAULT false, `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 INDEX `Asset_userId_createdAt_idx` (`userId`, `createdAt`), PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE TABLE `Stage` (
 `id` VARCHAR(191) NOT NULL, `pipelineId` VARCHAR(191) NOT NULL, `key` VARCHAR(191) NOT NULL,
 `name` VARCHAR(191) NOT NULL, `position` INTEGER NOT NULL DEFAULT 0, `workflowKind` VARCHAR(191) NOT NULL,
 `provider` VARCHAR(191) NULL, `modelId` VARCHAR(191) NULL, `workflowId` VARCHAR(191) NULL, `metadata` JSON NULL,
 UNIQUE INDEX `Stage_pipelineId_key_key` (`pipelineId`, `key`), PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE TABLE `QualityGate` (
 `id` VARCHAR(191) NOT NULL, `stageId` VARCHAR(191) NOT NULL, `threshold` DOUBLE NOT NULL DEFAULT 80,
 `enabled` BOOLEAN NOT NULL DEFAULT true, `criteria` JSON NOT NULL, `metadata` JSON NULL,
 UNIQUE INDEX `QualityGate_stageId_key` (`stageId`), PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE `User` ADD CONSTRAINT `User_roleId_fkey` FOREIGN KEY (`roleId`) REFERENCES `Role`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `RolePermission` ADD CONSTRAINT `RolePermission_roleId_fkey` FOREIGN KEY (`roleId`) REFERENCES `Role`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `RolePermission` ADD CONSTRAINT `RolePermission_permissionId_fkey` FOREIGN KEY (`permissionId`) REFERENCES `Permission`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `RefreshSession` ADD CONSTRAINT `RefreshSession_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `Task` ADD CONSTRAINT `Task_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `Task` ADD CONSTRAINT `Task_pipelineId_fkey` FOREIGN KEY (`pipelineId`) REFERENCES `Pipeline`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `AIModel` ADD CONSTRAINT `AIModel_serviceId_fkey` FOREIGN KEY (`serviceId`) REFERENCES `AIService`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `Workflow` ADD CONSTRAINT `Workflow_instanceId_fkey` FOREIGN KEY (`instanceId`) REFERENCES `AIService`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `WorkflowVersion` ADD CONSTRAINT `WorkflowVersion_workflowId_fkey` FOREIGN KEY (`workflowId`) REFERENCES `Workflow`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `Execution` ADD CONSTRAINT `Execution_taskId_fkey` FOREIGN KEY (`taskId`) REFERENCES `Task`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `Execution` ADD CONSTRAINT `Execution_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `Execution` ADD CONSTRAINT `Execution_serviceId_fkey` FOREIGN KEY (`serviceId`) REFERENCES `AIService`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `Execution` ADD CONSTRAINT `Execution_workflowId_fkey` FOREIGN KEY (`workflowId`) REFERENCES `Workflow`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `Execution` ADD CONSTRAINT `Execution_modelId_fkey` FOREIGN KEY (`modelId`) REFERENCES `AIModel`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `Asset` ADD CONSTRAINT `Asset_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `Asset` ADD CONSTRAINT `Asset_taskId_fkey` FOREIGN KEY (`taskId`) REFERENCES `Task`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `Asset` ADD CONSTRAINT `Asset_executionId_fkey` FOREIGN KEY (`executionId`) REFERENCES `Execution`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `Stage` ADD CONSTRAINT `Stage_pipelineId_fkey` FOREIGN KEY (`pipelineId`) REFERENCES `Pipeline`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `QualityGate` ADD CONSTRAINT `QualityGate_stageId_fkey` FOREIGN KEY (`stageId`) REFERENCES `Stage`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
