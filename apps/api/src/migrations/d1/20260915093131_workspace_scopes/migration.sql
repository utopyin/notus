ALTER TABLE `workspace_sources` RENAME TO `workspace_scopes`;--> statement-breakpoint
DROP INDEX IF EXISTS `workspace_sources_workspace`;--> statement-breakpoint
CREATE INDEX `workspace_scopes_workspace` ON `workspace_scopes` (`workspaceId`);