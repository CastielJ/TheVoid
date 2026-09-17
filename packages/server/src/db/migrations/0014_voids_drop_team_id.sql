ALTER TABLE "voids" DROP CONSTRAINT "voids_team_id_teams_id_fk";
--> statement-breakpoint
DROP INDEX IF EXISTS "voids_team_id_idx";--> statement-breakpoint
ALTER TABLE "voids" DROP COLUMN IF EXISTS "team_id";