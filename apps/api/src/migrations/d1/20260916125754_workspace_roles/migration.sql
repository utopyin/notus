CREATE TABLE `workspace_role_revisions` (
	`key` text PRIMARY KEY,
	`roleKey` text NOT NULL,
	`revision` integer NOT NULL,
	`body` text NOT NULL,
	`authorId` text NOT NULL,
	`createdAt` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `workspace_roles` (
	`key` text PRIMARY KEY,
	`workspaceId` text NOT NULL,
	`name` text NOT NULL,
	`body` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`authorId` text NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL
);
--> statement-breakpoint
DROP INDEX IF EXISTS `workspace_instruction_revisions_instruction`;--> statement-breakpoint
DROP INDEX IF EXISTS `workspace_instructions_workspace`;--> statement-breakpoint
CREATE INDEX `workspace_role_revisions_role` ON `workspace_role_revisions` (`roleKey`);--> statement-breakpoint
CREATE INDEX `workspace_roles_workspace` ON `workspace_roles` (`workspaceId`);--> statement-breakpoint
INSERT INTO `workspace_roles` (`key`, `workspaceId`, `name`, `body`, `revision`, `authorId`, `createdAt`, `updatedAt`)
SELECT json_array(`workspaceId`, `name`), `workspaceId`, `name`, `body`, `revision`, `authorId`, `createdAt`, `updatedAt`
FROM `workspace_instructions` WHERE `kind` = 'role';--> statement-breakpoint
INSERT INTO `workspace_role_revisions` (`key`, `roleKey`, `revision`, `body`, `authorId`, `createdAt`)
SELECT json_array(json_array(i.`workspaceId`, i.`name`), r.`revision`), json_array(i.`workspaceId`, i.`name`), r.`revision`, r.`body`, r.`authorId`, r.`createdAt`
FROM `workspace_instruction_revisions` r JOIN `workspace_instructions` i ON i.`key` = r.`instructionKey` WHERE i.`kind` = 'role';--> statement-breakpoint
DROP TABLE `workspace_instruction_revisions`;--> statement-breakpoint
DROP TABLE `workspace_instructions`;