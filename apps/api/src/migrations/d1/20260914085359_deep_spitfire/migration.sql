PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_inbox_routes` (
	`key` text PRIMARY KEY,
	`workspaceId` text NOT NULL,
	`taskId` text NOT NULL,
	`initiatorId` text NOT NULL,
	`startMessageKey` text NOT NULL,
	`startInputId` text NOT NULL,
	`startAt` text NOT NULL,
	`source` text NOT NULL,
	`createdAt` integer NOT NULL,
	`initialized` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_inbox_routes`(`key`, `workspaceId`, `taskId`, `initiatorId`, `startMessageKey`, `startInputId`, `startAt`, `source`, `createdAt`, `initialized`) SELECT `key`, `workspaceId`, `taskId`, `initiatorId`, `startMessageKey`, `startInputId`, `startAt`, `source`, `createdAt`, `initialized` FROM `inbox_routes`;--> statement-breakpoint
DROP TABLE `inbox_routes`;--> statement-breakpoint
ALTER TABLE `__new_inbox_routes` RENAME TO `inbox_routes`;--> statement-breakpoint
PRAGMA foreign_keys=ON;