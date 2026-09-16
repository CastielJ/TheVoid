-- Post-launch refinement pass: migrate existing free-text Task.tags (text[])
-- values into the new Organization-scoped `tags` table + `task_tags` join,
-- deduping case-insensitively per Organization so the same tag string used
-- on multiple Tasks becomes one shared row, not one per Task. Attributed to
-- each Task's own `created_by`, since free-text tags have no other natural
-- author. Runs single-threaded as part of migration (no concurrent writers
-- to race against), so no ON CONFLICT-based upsert is needed for `tags`
-- itself — a plain SELECT-then-INSERT-if-missing is sufficient and simpler.
DO $$
DECLARE
  t RECORD;
  tag_name text;
  trimmed_name text;
  org_id uuid;
  found_tag_id uuid;
BEGIN
  FOR t IN
    SELECT
      tasks.id AS task_id,
      tasks.tags AS tags,
      tasks.created_by AS created_by,
      voids.organization_id AS organization_id
    FROM tasks
    JOIN voids ON voids.id = tasks.void_id
    WHERE tasks.tags IS NOT NULL AND array_length(tasks.tags, 1) > 0
  LOOP
    org_id := t.organization_id;

    FOREACH tag_name IN ARRAY t.tags LOOP
      trimmed_name := trim(tag_name);
      IF trimmed_name = '' THEN
        CONTINUE;
      END IF;

      SELECT id INTO found_tag_id
      FROM tags
      WHERE organization_id = org_id AND lower(name) = lower(trimmed_name)
      LIMIT 1;

      IF found_tag_id IS NULL THEN
        INSERT INTO tags (organization_id, name, created_by)
        VALUES (org_id, trimmed_name, t.created_by)
        RETURNING id INTO found_tag_id;
      END IF;

      INSERT INTO task_tags (task_id, tag_id)
      VALUES (t.task_id, found_tag_id)
      ON CONFLICT DO NOTHING;

      found_tag_id := NULL;
    END LOOP;
  END LOOP;
END $$;
