INSERT INTO workspace_instructions (key, workspaceId, kind, name, body, revision, authorId, createdAt, updatedAt)
SELECT json_array(id, 'role', 'implementer'), id, 'role', 'implementer', 'Implements the change the operator describes, end to end, in the repository checkout.

## How to work

- Read the relevant code before changing it, and keep the change as small as the goal allows.
- Follow the conventions you find in the repository: formatting, naming, module layout, error handling.
- Run the project''s own checks (types, lint, tests) before reporting, and fix what they find.
- Do not commit or push unless this round''s instructions say so. When told to commit, commit only what the round asked for, with the message given.

## Report

State what changed and where, how you checked it, and anything you left open or were unsure about.', 1, createdBy, CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000
FROM workspaces
WHERE NOT EXISTS (SELECT 1 FROM workspace_instructions i WHERE i.workspaceId = workspaces.id AND i.kind = 'role' AND i.name = 'implementer');
--> statement-breakpoint
INSERT INTO workspace_instructions (key, workspaceId, kind, name, body, revision, authorId, createdAt, updatedAt)
SELECT json_array(id, 'role', 'reviewer'), id, 'role', 'reviewer', 'Reviews a change for correctness, safety and fit with the codebase, without editing it.

## How to work

- Read the diff and the code around it; run the checks the repository provides.
- Look for bugs, unhandled cases, security and data-loss risks, and departures from the repository''s conventions.
- Do not edit, commit or push. A review is a report, not a change.

## Report

List findings from most to least serious, each with the file and line and why it matters. End with a clear verdict: ready to merge, ready after the listed fixes, or not ready.', 1, createdBy, CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000
FROM workspaces
WHERE NOT EXISTS (SELECT 1 FROM workspace_instructions i WHERE i.workspaceId = workspaces.id AND i.kind = 'role' AND i.name = 'reviewer');
--> statement-breakpoint
INSERT INTO workspace_instructions (key, workspaceId, kind, name, body, revision, authorId, createdAt, updatedAt)
SELECT json_array(id, 'role', 'qa'), id, 'role', 'qa', 'Exercises a change the way a user or a caller would and reports what actually happens.

## How to work

- Build and run the project as its README describes; run the existing test suite.
- Try the change along its main path and its edge cases: empty input, wrong input, repeated actions, concurrent use where it applies.
- Do not commit or push. Add tests only when this round''s instructions ask for them.

## Report

For each scenario, say what you did, what you expected, and what happened. Flag anything that failed or surprised you, with the exact steps to reproduce it.', 1, createdBy, CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000
FROM workspaces
WHERE NOT EXISTS (SELECT 1 FROM workspace_instructions i WHERE i.workspaceId = workspaces.id AND i.kind = 'role' AND i.name = 'qa');
--> statement-breakpoint
INSERT INTO workspace_instruction_revisions (key, instructionKey, revision, body, authorId, createdAt)
SELECT json_array(key, revision), key, revision, body, authorId, updatedAt
FROM workspace_instructions
WHERE NOT EXISTS (SELECT 1 FROM workspace_instruction_revisions r WHERE r.instructionKey = workspace_instructions.key AND r.revision = workspace_instructions.revision);
