CREATE TABLE `execution_steps` (
	`id` text PRIMARY KEY,
	`invocationId` text NOT NULL,
	`index` integer NOT NULL,
	`operationId` text NOT NULL UNIQUE,
	`status` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`dueAt` integer NOT NULL,
	`recoverAt` integer,
	`parts` text,
	`text` text,
	`final` integer DEFAULT false NOT NULL,
	`failure` text,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	CONSTRAINT `fk_execution_steps_invocationId_execution_invocations_id_fk` FOREIGN KEY (`invocationId`) REFERENCES `execution_invocations`(`id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `execution_step_index` ON `execution_steps` (`invocationId`,`index`);--> statement-breakpoint
CREATE INDEX `execution_step_due` ON `execution_steps` (`status`,`dueAt`);