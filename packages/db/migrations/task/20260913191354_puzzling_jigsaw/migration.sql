CREATE TABLE `execution_enrollments` (
	`attemptId` text NOT NULL,
	`revision` integer NOT NULL,
	`requestId` text NOT NULL,
	`request` text NOT NULL,
	`grant` text NOT NULL,
	`acceptedAt` integer NOT NULL,
	CONSTRAINT `fk_execution_enrollments_attemptId_execution_attempts_id_fk` FOREIGN KEY (`attemptId`) REFERENCES `execution_attempts`(`id`)
);
--> statement-breakpoint
CREATE TABLE `execution_provisioning` (
	`attemptId` text PRIMARY KEY,
	`operationId` text NOT NULL UNIQUE,
	`providerName` text NOT NULL UNIQUE,
	`capabilityId` text NOT NULL UNIQUE,
	`state` text NOT NULL,
	CONSTRAINT `fk_execution_provisioning_attemptId_execution_attempts_id_fk` FOREIGN KEY (`attemptId`) REFERENCES `execution_attempts`(`id`)
);
--> statement-breakpoint
CREATE TABLE `execution_readiness` (
	`attemptId` text NOT NULL,
	`epoch` integer NOT NULL,
	`observationId` text NOT NULL,
	`receipt` text NOT NULL,
	CONSTRAINT `fk_execution_readiness_attemptId_execution_attempts_id_fk` FOREIGN KEY (`attemptId`) REFERENCES `execution_attempts`(`id`)
);
--> statement-breakpoint
CREATE TABLE `execution_wakes` (
	`inputId` text PRIMARY KEY,
	`attemptId` text NOT NULL,
	`receipt` text NOT NULL,
	CONSTRAINT `fk_execution_wakes_attemptId_execution_attempts_id_fk` FOREIGN KEY (`attemptId`) REFERENCES `execution_attempts`(`id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `execution_enrollment_revision` ON `execution_enrollments` (`attemptId`,`revision`);--> statement-breakpoint
CREATE UNIQUE INDEX `execution_enrollment_request` ON `execution_enrollments` (`attemptId`,`requestId`);--> statement-breakpoint
CREATE UNIQUE INDEX `execution_readiness_epoch` ON `execution_readiness` (`attemptId`,`epoch`);--> statement-breakpoint
CREATE UNIQUE INDEX `execution_readiness_observation` ON `execution_readiness` (`attemptId`,`observationId`);