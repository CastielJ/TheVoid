-- Post-launch refinement pass: backfill username/visible_name for rows that
-- predate these columns (the small number of test accounts created during
-- Railway deploy verification — no real users yet). Must run BEFORE the
-- follow-up migration that adds NOT NULL + relies on `username` uniqueness,
-- so this normalizes (strips characters outside [a-z0-9_], enforces the
-- 3-20 length bound the application will also validate) and de-duplicates
-- collisions with a numeric suffix rather than writing raw, possibly
-- colliding/invalid email local-parts straight into the column.
DO $$
DECLARE
  r RECORD;
  base_username text;
  candidate text;
  suffix int;
  suffix_text text;
BEGIN
  FOR r IN SELECT id, email FROM users WHERE username IS NULL ORDER BY created_at LOOP
    base_username := lower(regexp_replace(split_part(r.email, '@', 1), '[^a-z0-9_]', '', 'gi'));
    base_username := substr(base_username, 1, 20);
    IF length(base_username) < 3 THEN
      base_username := rpad(base_username, 3, '0');
    END IF;

    candidate := base_username;
    suffix := 1;
    WHILE EXISTS (SELECT 1 FROM users WHERE username = candidate) LOOP
      suffix := suffix + 1;
      suffix_text := suffix::text;
      candidate := substr(base_username, 1, greatest(3, 20 - length(suffix_text) - 1)) || '_' || suffix_text;
    END LOOP;

    UPDATE users
    SET
      username = candidate,
      visible_name = COALESCE(NULLIF(split_part(r.email, '@', 1), ''), 'User')
    WHERE id = r.id;
  END LOOP;
END $$;
