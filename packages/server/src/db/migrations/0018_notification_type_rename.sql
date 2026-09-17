-- Third feature pass: notificationTypeValues renamed team_join_requested/
-- team_join_approved/team_join_denied -> void_join_requested/void_join_approved/
-- void_join_denied (Team merged into Void). The `type` column is plain text
-- with an app-level enum check (no native Postgres enum type), so no ALTER
-- TYPE is needed here -- just carry existing rows' values forward so they
-- still render correctly under the renamed type instead of hitting an
-- unrecognized-type fallback in the frontend.
UPDATE "notifications" SET "type" = 'void_join_requested' WHERE "type" = 'team_join_requested';--> statement-breakpoint
UPDATE "notifications" SET "type" = 'void_join_approved' WHERE "type" = 'team_join_approved';--> statement-breakpoint
UPDATE "notifications" SET "type" = 'void_join_denied' WHERE "type" = 'team_join_denied';
