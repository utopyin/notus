CREATE TABLE `account_device_logins` (
	`singleton` integer PRIMARY KEY,
	`userId` text NOT NULL,
	`deviceAuthId` text NOT NULL,
	`userCode` text NOT NULL,
	`interval` integer NOT NULL,
	`startedAt` integer NOT NULL
);
--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_account_connections` (
	`provider` text PRIMARY KEY,
	`userId` text NOT NULL,
	`accountId` text NOT NULL,
	`access` text NOT NULL,
	`refresh` text NOT NULL,
	`idToken` text,
	`expiresAt` integer NOT NULL,
	`seedFingerprint` text NOT NULL,
	`provenance` text DEFAULT 'dashboard' NOT NULL,
	`linkedAt` integer NOT NULL,
	`rotatedAt` integer,
	`revokedAt` integer
);
--> statement-breakpoint
DROP TABLE `account_connections`;--> statement-breakpoint
ALTER TABLE `__new_account_connections` RENAME TO `account_connections`;--> statement-breakpoint
PRAGMA foreign_keys=ON;