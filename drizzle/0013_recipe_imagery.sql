CREATE TABLE "cover_attempts" (
	"request_id" uuid PRIMARY KEY NOT NULL,
	"output_base64" text,
	"media_type" text,
	"cost_usd" numeric(20, 10),
	"generation_id" text,
	"latency_ms" integer,
	"credential_source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cover_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"recipe_id" uuid NOT NULL,
	"requested_by_user_id" uuid NOT NULL,
	"idempotency_key" text NOT NULL,
	"snapshot" jsonb NOT NULL,
	"content_hash" text NOT NULL,
	"expected_cover_revision" integer NOT NULL,
	"model" text NOT NULL,
	"prompt_version" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"reserved_usd" numeric(20, 10) NOT NULL,
	"candidate_photo_id" uuid,
	"error_message" text,
	"dispatched_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "photos" ADD COLUMN "origin" text DEFAULT 'user' NOT NULL;--> statement-breakpoint
ALTER TABLE "photos" ADD COLUMN "original_object_key" text;--> statement-breakpoint
ALTER TABLE "photos" ADD COLUMN "derivatives" jsonb;--> statement-breakpoint
ALTER TABLE "photos" ADD COLUMN "provenance" jsonb;--> statement-breakpoint
ALTER TABLE "recipes" ADD COLUMN "cover_selection" text DEFAULT 'auto' NOT NULL;--> statement-breakpoint
ALTER TABLE "recipes" ADD COLUMN "cover_revision" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "cover_attempts" ADD CONSTRAINT "cover_attempts_request_id_cover_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."cover_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cover_requests" ADD CONSTRAINT "cover_requests_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cover_requests" ADD CONSTRAINT "cover_requests_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cover_requests" ADD CONSTRAINT "cover_requests_candidate_photo_id_photos_id_fk" FOREIGN KEY ("candidate_photo_id") REFERENCES "public"."photos"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cover_requests" ADD CONSTRAINT "cover_requests_workspace_recipe_fk" FOREIGN KEY ("workspace_id","recipe_id") REFERENCES "public"."recipes"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "cover_requests_idempotency_idx" ON "cover_requests" USING btree ("workspace_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "cover_requests_active_idx" ON "cover_requests" USING btree ("recipe_id") WHERE "cover_requests"."status" in ('queued', 'running');
--> statement-breakpoint
UPDATE "recipes" SET "cover_selection" = 'selected' WHERE "cover_photo_id" IS NOT NULL;
