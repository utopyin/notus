CREATE TABLE `account_connections` (
	`singleton` integer PRIMARY KEY,
	`userId` text NOT NULL,
	`provider` text NOT NULL,
	`accountId` text NOT NULL,
	`access` text NOT NULL,
	`refresh` text NOT NULL,
	`expiresAt` integer NOT NULL,
	`seedFingerprint` text NOT NULL,
	`provenance` text DEFAULT 'admin-fixture' NOT NULL,
	`linkedAt` integer NOT NULL,
	`rotatedAt` integer,
	`revokedAt` integer
);
--> statement-breakpoint
CREATE TABLE `account_forwards` (
	`operationId` text PRIMARY KEY,
	`status` integer NOT NULL,
	`contentType` text,
	`body` text NOT NULL,
	`createdAt` integer NOT NULL
);
