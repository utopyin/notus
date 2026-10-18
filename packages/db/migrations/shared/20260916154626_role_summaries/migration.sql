ALTER TABLE `workspace_role_revisions` ADD `summary` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `workspace_roles` ADD `summary` text DEFAULT '' NOT NULL;--> statement-breakpoint
UPDATE `workspace_roles` SET
	`summary` = CASE WHEN instr(`body`, char(10)) > 0 THEN substr(`body`, 1, instr(`body`, char(10)) - 1) ELSE `body` END,
	`body` = CASE WHEN instr(`body`, char(10)) > 0 THEN ltrim(substr(`body`, instr(`body`, char(10)) + 1), char(10)) ELSE '' END
WHERE `summary` = '';--> statement-breakpoint
UPDATE `workspace_role_revisions` SET
	`summary` = CASE WHEN instr(`body`, char(10)) > 0 THEN substr(`body`, 1, instr(`body`, char(10)) - 1) ELSE `body` END,
	`body` = CASE WHEN instr(`body`, char(10)) > 0 THEN ltrim(substr(`body`, instr(`body`, char(10)) + 1), char(10)) ELSE '' END
WHERE `summary` = '';
