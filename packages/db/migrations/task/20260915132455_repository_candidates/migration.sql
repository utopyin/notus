PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_execution_repository` (
	`singleton` integer PRIMARY KEY,
	`candidates` text NOT NULL,
	`repository` text,
	`capturedAt` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_execution_repository`(`singleton`, `candidates`, `repository`, `capturedAt`) SELECT `singleton`, '[]', `repository`, `capturedAt` FROM `execution_repository`;--> statement-breakpoint
DROP TABLE `execution_repository`;--> statement-breakpoint
ALTER TABLE `__new_execution_repository` RENAME TO `execution_repository`;--> statement-breakpoint
PRAGMA foreign_keys=ON;