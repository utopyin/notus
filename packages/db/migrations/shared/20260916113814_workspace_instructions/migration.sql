CREATE TABLE `workspace_instruction_revisions` (
	`key` text PRIMARY KEY,
	`instructionKey` text NOT NULL,
	`revision` integer NOT NULL,
	`body` text NOT NULL,
	`authorId` text NOT NULL,
	`createdAt` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `workspace_instructions` (
	`key` text PRIMARY KEY,
	`workspaceId` text NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`body` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`authorId` text NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `workspace_instruction_revisions_instruction` ON `workspace_instruction_revisions` (`instructionKey`);--> statement-breakpoint
CREATE INDEX `workspace_instructions_workspace` ON `workspace_instructions` (`workspaceId`);