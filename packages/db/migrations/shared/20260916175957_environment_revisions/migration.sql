CREATE TABLE `workspace_environment_revisions` (
	`key` text PRIMARY KEY,
	`workspaceId` text NOT NULL,
	`revision` integer NOT NULL,
	`provider` text NOT NULL,
	`config` text NOT NULL,
	`authorId` text,
	`createdAt` integer NOT NULL,
	CONSTRAINT "workspace_environment_revisions_config" CHECK(json_valid("config"))
);
--> statement-breakpoint
CREATE INDEX `workspace_environment_revisions_workspace` ON `workspace_environment_revisions` (`workspaceId`);--> statement-breakpoint
INSERT INTO `workspace_environment_revisions` (`key`, `workspaceId`, `revision`, `provider`, `config`, `authorId`, `createdAt`)
SELECT json_array(`workspaceId`, `revision`), `workspaceId`, `revision`, `provider`, `config`, NULL, CAST(strftime('%s', 'now') AS INTEGER) * 1000
FROM `workspace_environments`;
