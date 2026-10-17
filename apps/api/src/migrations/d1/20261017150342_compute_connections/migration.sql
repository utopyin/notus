CREATE TABLE `workspace_compute_connections` (
	`key` text PRIMARY KEY,
	`workspaceId` text NOT NULL,
	`provider` text NOT NULL,
	`label` text DEFAULT '' NOT NULL,
	`connectedBy` text NOT NULL,
	`connectedAt` integer NOT NULL,
	`credential` text NOT NULL,
	CONSTRAINT "workspace_compute_connections_provider" CHECK(length("provider") > 0)
);
--> statement-breakpoint
ALTER TABLE `workspace_images` RENAME TO `workspace_templates`;--> statement-breakpoint
ALTER TABLE `workspace_templates` ADD `isDefault` integer DEFAULT false NOT NULL;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_workspace_templates` (
	`key` text PRIMARY KEY,
	`workspaceId` text NOT NULL,
	`provider` text NOT NULL,
	`ref` text NOT NULL,
	`label` text DEFAULT '' NOT NULL,
	`isDefault` integer DEFAULT false NOT NULL,
	`addedBy` text NOT NULL,
	`addedAt` integer NOT NULL,
	CONSTRAINT "workspace_templates_provider" CHECK(length("provider") > 0),
	CONSTRAINT "workspace_templates_ref" CHECK(length("ref") BETWEEN 1 AND 1024)
);
--> statement-breakpoint
INSERT INTO `__new_workspace_templates`(`key`, `workspaceId`, `provider`, `ref`, `label`, `addedBy`, `addedAt`) SELECT `key`, `workspaceId`, `provider`, `ref`, `label`, `addedBy`, `addedAt` FROM `workspace_templates`;--> statement-breakpoint
DROP TABLE `workspace_templates`;--> statement-breakpoint
ALTER TABLE `__new_workspace_templates` RENAME TO `workspace_templates`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
DROP INDEX IF EXISTS `workspace_images_workspace`;--> statement-breakpoint
CREATE INDEX `workspace_templates_workspace` ON `workspace_templates` (`workspaceId`);--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_templates_default` ON `workspace_templates` (`workspaceId`,`provider`) WHERE "workspace_templates"."isDefault" = 1;--> statement-breakpoint
CREATE INDEX `workspace_compute_connections_workspace` ON `workspace_compute_connections` (`workspaceId`);