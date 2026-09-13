CREATE TABLE `account_identities` (
	`key` text PRIMARY KEY,
	`kind` text NOT NULL,
	`installationId` text NOT NULL,
	`externalId` text NOT NULL,
	`userId` text NOT NULL,
	`provenance` text DEFAULT 'admin-fixture' NOT NULL,
	CONSTRAINT `fk_account_identities_userId_account_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `account_users`(`id`)
);
--> statement-breakpoint
CREATE TABLE `account_users` (
	`id` text PRIMARY KEY
);
--> statement-breakpoint
CREATE TABLE `workspace_channels` (
	`key` text PRIMARY KEY,
	`workspaceId` text NOT NULL,
	`teamId` text NOT NULL,
	`channelId` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `workspace_memberships` (
	`key` text PRIMARY KEY,
	`workspaceId` text NOT NULL,
	`userId` text NOT NULL,
	`provenance` text DEFAULT 'admin-fixture' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `inbox_envelopes` (
	`key` text PRIMARY KEY,
	`workspaceId` text NOT NULL,
	`messageKey` text NOT NULL,
	`payload` text NOT NULL,
	`receivedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `inbox_messages` (
	`key` text PRIMARY KEY,
	`workspaceId` text NOT NULL,
	`conversationKey` text NOT NULL,
	`inputId` text NOT NULL,
	`payload` text NOT NULL,
	`fingerprint` text NOT NULL,
	`occurredAt` text NOT NULL,
	`startIntent` integer DEFAULT 0 NOT NULL,
	`initiatorId` text,
	`receivedAt` integer NOT NULL,
	`state` text DEFAULT 'pending' NOT NULL,
	`token` text,
	`generation` integer DEFAULT 0 NOT NULL,
	`recoverAt` integer DEFAULT 0 NOT NULL,
	`dueAt` integer NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`lastError` text
);
--> statement-breakpoint
CREATE TABLE `inbox_routes` (
	`key` text PRIMARY KEY,
	`workspaceId` text NOT NULL,
	`taskId` text NOT NULL UNIQUE,
	`initiatorId` text NOT NULL,
	`startMessageKey` text NOT NULL,
	`startInputId` text NOT NULL,
	`startAt` text NOT NULL,
	`source` text NOT NULL,
	`createdAt` integer NOT NULL,
	`initialized` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_channels_scope` ON `workspace_channels` (`workspaceId`,`teamId`,`channelId`);--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_memberships_user` ON `workspace_memberships` (`workspaceId`,`userId`);--> statement-breakpoint
CREATE INDEX `inbox_envelopes_message` ON `inbox_envelopes` (`messageKey`);--> statement-breakpoint
CREATE INDEX `inbox_messages_due` ON `inbox_messages` (`state`,`dueAt`,`receivedAt`,`key`);--> statement-breakpoint
CREATE INDEX `inbox_messages_recovery` ON `inbox_messages` (`state`,`recoverAt`);--> statement-breakpoint
CREATE INDEX `inbox_messages_conversation` ON `inbox_messages` (`conversationKey`,`state`);--> statement-breakpoint
CREATE UNIQUE INDEX `inbox_messages_input` ON `inbox_messages` (`workspaceId`,`inputId`);