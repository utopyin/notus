CREATE TABLE `execution_repository` (
	`singleton` integer PRIMARY KEY,
	`repository` text NOT NULL,
	`capturedAt` integer NOT NULL
);
