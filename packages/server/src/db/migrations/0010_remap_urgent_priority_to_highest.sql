-- Post-launch refinement pass: tasks.priority is a plain `text` column
-- (Drizzle's `{ enum: [...] }` is TypeScript-only metadata, no DB enum type
-- or CHECK constraint exists) — the 4-level to 6-level value-list change in
-- @void/shared's taskPriorityValues therefore produces no schema diff.
-- `low`/`medium`/`high` remain valid as-is; only `urgent` needs remapping to
-- its nearest equivalent in the new set.
UPDATE tasks SET priority = 'highest' WHERE priority = 'urgent';
