CREATE TABLE IF NOT EXISTS "void_cameras" (
	"void_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"x" double precision NOT NULL,
	"y" double precision NOT NULL,
	"zoom" double precision NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "void_cameras_void_id_user_id_pk" PRIMARY KEY("void_id","user_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "void_cameras" ADD CONSTRAINT "void_cameras_void_id_voids_id_fk" FOREIGN KEY ("void_id") REFERENCES "public"."voids"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "void_cameras" ADD CONSTRAINT "void_cameras_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
