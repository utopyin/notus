CREATE TABLE `task_deliveries` (
	`id` text PRIMARY KEY,
	`inputId` text NOT NULL,
	`responseId` text UNIQUE,
	`kind` text NOT NULL,
	`text` text,
	`digest` text NOT NULL,
	`status` text NOT NULL,
	`retryAt` integer NOT NULL,
	`claimId` text,
	`generation` integer DEFAULT 0 NOT NULL,
	`recoverAt` integer,
	`receipt` text,
	`failure` text,
	`outcome` text,
	CONSTRAINT `fk_task_deliveries_inputId_task_inputs_id_fk` FOREIGN KEY (`inputId`) REFERENCES `task_inputs`(`id`),
	CONSTRAINT `fk_task_deliveries_responseId_task_responses_id_fk` FOREIGN KEY (`responseId`) REFERENCES `task_responses`(`id`)
);
--> statement-breakpoint
CREATE TABLE `task_events` (
	`id` text PRIMARY KEY,
	`inputId` text NOT NULL,
	CONSTRAINT `fk_task_events_inputId_task_inputs_id_fk` FOREIGN KEY (`inputId`) REFERENCES `task_inputs`(`id`)
);
--> statement-breakpoint
CREATE TABLE `task_inputs` (
	`id` text PRIMARY KEY,
	`messageKey` text NOT NULL UNIQUE,
	`sourceId` text NOT NULL,
	`input` text NOT NULL,
	`obligation` text NOT NULL,
	`createdAt` integer NOT NULL,
	`fulfilledAt` integer,
	CONSTRAINT `fk_task_inputs_sourceId_task_sources_id_fk` FOREIGN KEY (`sourceId`) REFERENCES `task_sources`(`id`)
);
--> statement-breakpoint
CREATE TABLE `task_responses` (
	`id` text PRIMARY KEY,
	`inputId` text NOT NULL,
	`resultId` text NOT NULL UNIQUE,
	`text` text NOT NULL,
	`final` integer NOT NULL,
	`createdAt` integer NOT NULL,
	CONSTRAINT `fk_task_responses_inputId_task_inputs_id_fk` FOREIGN KEY (`inputId`) REFERENCES `task_inputs`(`id`)
);
--> statement-breakpoint
CREATE TABLE `task_sources` (
	`id` text PRIMARY KEY,
	`taskId` text NOT NULL,
	`attachment` text NOT NULL,
	CONSTRAINT `fk_task_sources_taskId_tasks_id_fk` FOREIGN KEY (`taskId`) REFERENCES `tasks`(`id`)
);
--> statement-breakpoint
CREATE TABLE `tasks` (
	`singleton` integer PRIMARY KEY,
	`id` text NOT NULL UNIQUE,
	`reservation` text NOT NULL,
	`mode` text NOT NULL,
	`originSourceId` text NOT NULL,
	`createdAt` integer NOT NULL,
	`closedAt` integer,
	CONSTRAINT "tasks_singleton" CHECK("singleton" = 1)
);
--> statement-breakpoint
CREATE TABLE `execution_attempts` (
	`id` text PRIMARY KEY,
	`taskId` text NOT NULL,
	`generation` integer NOT NULL,
	`mode` text NOT NULL,
	`active` integer NOT NULL,
	`createdAt` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `execution_invocations` (
	`id` text PRIMARY KEY,
	`attemptId` text NOT NULL,
	`generation` integer NOT NULL,
	`inputId` text NOT NULL UNIQUE,
	`operationId` text NOT NULL UNIQUE,
	`dueAt` integer NOT NULL,
	`version` integer NOT NULL,
	`resultId` text NOT NULL UNIQUE,
	`content` text NOT NULL,
	`digest` text NOT NULL,
	`status` text NOT NULL,
	CONSTRAINT `fk_execution_invocations_attemptId_execution_attempts_id_fk` FOREIGN KEY (`attemptId`) REFERENCES `execution_attempts`(`id`)
);
--> statement-breakpoint
CREATE TABLE `execution_outcomes` (
	`id` text PRIMARY KEY,
	`invocationId` text NOT NULL UNIQUE,
	`observation` text NOT NULL,
	`acceptedAt` integer NOT NULL,
	CONSTRAINT `fk_execution_outcomes_invocationId_execution_invocations_id_fk` FOREIGN KEY (`invocationId`) REFERENCES `execution_invocations`(`id`)
);
--> statement-breakpoint
CREATE INDEX `task_delivery_due` ON `task_deliveries` (`status`,`retryAt`);--> statement-breakpoint
CREATE INDEX `task_delivery_recovery` ON `task_deliveries` (`status`,`recoverAt`);--> statement-breakpoint
CREATE INDEX `task_delivery_input` ON `task_deliveries` (`inputId`);--> statement-breakpoint
CREATE UNIQUE INDEX `execution_active_task` ON `execution_attempts` (`taskId`) WHERE "execution_attempts"."active" = 1;--> statement-breakpoint
CREATE UNIQUE INDEX `execution_task_generation` ON `execution_attempts` (`taskId`,`generation`);--> statement-breakpoint
CREATE INDEX `execution_invocation_due` ON `execution_invocations` (`status`,`dueAt`);