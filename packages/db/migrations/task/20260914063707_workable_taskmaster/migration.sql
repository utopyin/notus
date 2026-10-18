CREATE TABLE `execution_commands` (
	`id` text PRIMARY KEY,
	`attemptId` text NOT NULL,
	`generation` integer NOT NULL,
	`stepId` text NOT NULL,
	`callId` text NOT NULL,
	`spec` text NOT NULL,
	`status` text NOT NULL,
	`claimEpoch` integer,
	`claimedAt` integer,
	`result` text,
	`failure` text,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	CONSTRAINT `fk_execution_commands_attemptId_execution_attempts_id_fk` FOREIGN KEY (`attemptId`) REFERENCES `execution_attempts`(`id`),
	CONSTRAINT `fk_execution_commands_stepId_execution_steps_id_fk` FOREIGN KEY (`stepId`) REFERENCES `execution_steps`(`id`)
);
--> statement-breakpoint
CREATE TABLE `execution_polls` (
	`singleton` integer PRIMARY KEY,
	`epoch` integer NOT NULL,
	`polledAt` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `execution_command_call` ON `execution_commands` (`stepId`,`callId`);--> statement-breakpoint
CREATE INDEX `execution_command_status` ON `execution_commands` (`status`,`createdAt`);