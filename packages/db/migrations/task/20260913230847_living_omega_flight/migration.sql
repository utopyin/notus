CREATE TABLE `execution_environment` (
	`singleton` integer PRIMARY KEY,
	`environment` text NOT NULL,
	`capturedAt` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `execution_steps` ADD `calls` text;