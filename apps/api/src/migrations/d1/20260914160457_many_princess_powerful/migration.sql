CREATE TABLE `account_logins` (
	`authUserId` text PRIMARY KEY,
	`userId` text NOT NULL,
	`linkedAt` integer NOT NULL,
	CONSTRAINT `fk_account_logins_userId_account_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `account_users`(`id`)
);
--> statement-breakpoint
CREATE TABLE `workspace_invites` (
	`id` text PRIMARY KEY,
	`workspaceId` text NOT NULL,
	`tokenHash` text NOT NULL,
	`role` text NOT NULL,
	`invitedBy` text NOT NULL,
	`createdAt` integer NOT NULL,
	`expiresAt` integer NOT NULL,
	`acceptedBy` text,
	`acceptedAt` integer,
	`revokedAt` integer
);
--> statement-breakpoint
CREATE TABLE `workspaces` (
	`id` text PRIMARY KEY,
	`name` text NOT NULL,
	`slug` text NOT NULL UNIQUE,
	`createdBy` text NOT NULL,
	`createdAt` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `workspace_memberships` ADD `role` text DEFAULT 'member' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_invites_token` ON `workspace_invites` (`tokenHash`);