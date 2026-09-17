ALTER TABLE "voids" ADD COLUMN "parent_void_id" uuid;--> statement-breakpoint
ALTER TABLE "voids" ADD COLUMN "visibility" text DEFAULT 'private' NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "voids" ADD CONSTRAINT "voids_parent_void_id_voids_id_fk" FOREIGN KEY ("parent_void_id") REFERENCES "public"."voids"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "voids_parent_void_id_idx" ON "voids" USING btree ("parent_void_id");