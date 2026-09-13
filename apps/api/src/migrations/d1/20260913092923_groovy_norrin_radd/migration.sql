CREATE TABLE `workspace_environments` (
	`workspaceId` text PRIMARY KEY,
	`provider` text NOT NULL,
	`config` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	CONSTRAINT "workspace_environments_workspace" CHECK(length("workspaceId") > 0),
	CONSTRAINT "workspace_environments_provider" CHECK(length("provider") > 0),
	CONSTRAINT "workspace_environments_config" CHECK(json_valid("config")),
	CONSTRAINT "workspace_environments_revision" CHECK(typeof("revision") = 'integer' AND "revision" BETWEEN 1 AND 9007199254740991)
);
