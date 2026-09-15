CREATE TABLE `auth_accounts` (
	`id` text PRIMARY KEY,
	`accountId` text NOT NULL,
	`providerId` text NOT NULL,
	`userId` text NOT NULL,
	`accessToken` text,
	`refreshToken` text,
	`idToken` text,
	`accessTokenExpiresAt` text,
	`refreshTokenExpiresAt` text,
	`scope` text,
	`password` text,
	`createdAt` text NOT NULL,
	`updatedAt` text NOT NULL,
	CONSTRAINT `fk_auth_accounts_userId_auth_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `auth_users`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `auth_sessions` (
	`id` text PRIMARY KEY,
	`expiresAt` text NOT NULL,
	`token` text NOT NULL UNIQUE,
	`createdAt` text NOT NULL,
	`updatedAt` text NOT NULL,
	`ipAddress` text,
	`userAgent` text,
	`userId` text NOT NULL,
	CONSTRAINT `fk_auth_sessions_userId_auth_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `auth_users`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `auth_users` (
	`id` text PRIMARY KEY,
	`name` text NOT NULL,
	`email` text NOT NULL UNIQUE,
	`emailVerified` integer NOT NULL,
	`image` text,
	`createdAt` text NOT NULL,
	`updatedAt` text NOT NULL,
	`slackTeamId` text,
	`githubLogin` text
);
--> statement-breakpoint
CREATE TABLE `auth_verifications` (
	`id` text PRIMARY KEY,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expiresAt` text NOT NULL,
	`createdAt` text NOT NULL,
	`updatedAt` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `auth_accounts_user` ON `auth_accounts` (`userId`);--> statement-breakpoint
CREATE INDEX `auth_sessions_user` ON `auth_sessions` (`userId`);--> statement-breakpoint
CREATE INDEX `auth_verifications_identifier` ON `auth_verifications` (`identifier`);