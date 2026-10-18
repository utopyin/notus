CREATE TABLE `workspace_images` (
	`key` text PRIMARY KEY,
	`workspaceId` text NOT NULL,
	`provider` text NOT NULL,
	`ref` text NOT NULL,
	`label` text DEFAULT '' NOT NULL,
	`addedBy` text NOT NULL,
	`addedAt` integer NOT NULL,
	CONSTRAINT "workspace_images_provider" CHECK(length("provider") > 0),
	CONSTRAINT "workspace_images_ref" CHECK(length("ref") BETWEEN 1 AND 1024)
);
--> statement-breakpoint
CREATE INDEX `workspace_images_workspace` ON `workspace_images` (`workspaceId`);