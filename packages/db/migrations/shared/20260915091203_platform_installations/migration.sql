CREATE TABLE `workspace_installations` (
	`key` text PRIMARY KEY,
	`workspaceId` text NOT NULL,
	`platform` text NOT NULL,
	`installationId` text NOT NULL,
	`label` text DEFAULT '' NOT NULL,
	`installedBy` text NOT NULL,
	`installedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `workspace_sources` (
	`key` text PRIMARY KEY,
	`workspaceId` text NOT NULL,
	`platform` text NOT NULL,
	`installationId` text NOT NULL,
	`scope` text NOT NULL,
	`label` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
DROP INDEX IF EXISTS `workspace_channels_scope`;--> statement-breakpoint
CREATE INDEX `workspace_installations_workspace` ON `workspace_installations` (`workspaceId`);--> statement-breakpoint
CREATE INDEX `workspace_sources_workspace` ON `workspace_sources` (`workspaceId`);--> statement-breakpoint
DROP TABLE `workspace_channels`;