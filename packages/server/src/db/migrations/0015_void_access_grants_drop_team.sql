-- Third feature pass: Team merged into Void — grants to a whole Team (as
-- opposed to a plain per-user grant) no longer have a meaningful target,
-- since Team no longer exists as a separate entity. Remove them before the
-- NOT NULL constraint below, which would otherwise fail on any row where
-- user_id is still null (a team-only grant).
DELETE FROM "void_access_grants" WHERE "team_id" IS NOT NULL AND "user_id" IS NULL;--> statement-breakpoint
ALTER TABLE "void_access_grants" DROP CONSTRAINT "void_access_grants_exactly_one_target_check";--> statement-breakpoint
ALTER TABLE "void_access_grants" DROP CONSTRAINT "void_access_grants_team_id_teams_id_fk";
--> statement-breakpoint
DROP INDEX IF EXISTS "void_access_grants_team_id_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "void_access_grants_void_id_team_id_idx";--> statement-breakpoint
ALTER TABLE "void_access_grants" ALTER COLUMN "user_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "void_access_grants" DROP COLUMN IF EXISTS "team_id";