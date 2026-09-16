CREATE TABLE IF NOT EXISTS "groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"void_id" uuid NOT NULL,
	"name" text NOT NULL,
	"x" double precision NOT NULL,
	"y" double precision NOT NULL,
	"width" double precision NOT NULL,
	"height" double precision NOT NULL,
	"version" bigint DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "void_access_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"void_id" uuid NOT NULL,
	"team_id" uuid,
	"user_id" uuid,
	"role" text NOT NULL,
	"granted_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "void_access_grants_exactly_one_target_check" CHECK (("void_access_grants"."team_id" IS NOT NULL AND "void_access_grants"."user_id" IS NULL) OR ("void_access_grants"."team_id" IS NULL AND "void_access_grants"."user_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "voids" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"team_id" uuid,
	"name" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "groups" ADD CONSTRAINT "groups_void_id_voids_id_fk" FOREIGN KEY ("void_id") REFERENCES "public"."voids"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "void_access_grants" ADD CONSTRAINT "void_access_grants_void_id_voids_id_fk" FOREIGN KEY ("void_id") REFERENCES "public"."voids"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "void_access_grants" ADD CONSTRAINT "void_access_grants_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "void_access_grants" ADD CONSTRAINT "void_access_grants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "void_access_grants" ADD CONSTRAINT "void_access_grants_granted_by_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "voids" ADD CONSTRAINT "voids_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "voids" ADD CONSTRAINT "voids_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "voids" ADD CONSTRAINT "voids_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "groups_void_id_idx" ON "groups" USING btree ("void_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "void_access_grants_void_id_idx" ON "void_access_grants" USING btree ("void_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "void_access_grants_team_id_idx" ON "void_access_grants" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "void_access_grants_user_id_idx" ON "void_access_grants" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "void_access_grants_void_id_team_id_idx" ON "void_access_grants" USING btree ("void_id","team_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "void_access_grants_void_id_user_id_idx" ON "void_access_grants" USING btree ("void_id","user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "voids_organization_id_idx" ON "voids" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "voids_team_id_idx" ON "voids" USING btree ("team_id");