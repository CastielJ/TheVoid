CREATE TABLE IF NOT EXISTS "void_join_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"void_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"granted_role" text
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "void_join_requests" ADD CONSTRAINT "void_join_requests_void_id_voids_id_fk" FOREIGN KEY ("void_id") REFERENCES "public"."voids"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "void_join_requests" ADD CONSTRAINT "void_join_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "void_join_requests" ADD CONSTRAINT "void_join_requests_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "void_join_requests_void_id_idx" ON "void_join_requests" USING btree ("void_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "void_join_requests_user_id_idx" ON "void_join_requests" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "void_join_requests_void_id_user_id_pending_idx" ON "void_join_requests" USING btree ("void_id","user_id") WHERE "void_join_requests"."status" = 'pending';