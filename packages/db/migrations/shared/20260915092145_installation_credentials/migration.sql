CREATE TABLE `workspace_install_intents` (
	`nonce` text PRIMARY KEY,
	`workspaceId` text NOT NULL,
	`userId` text NOT NULL,
	`platform` text NOT NULL,
	`createdAt` integer NOT NULL,
	`expiresAt` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `workspace_installations` ADD `credential` text;