CREATE TABLE "cooking_session_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"body" text NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cooking_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"recipe_id" uuid NOT NULL,
	"recipe_version_id" uuid NOT NULL,
	"started_by_user_id" uuid,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"status" text DEFAULT 'active' NOT NULL,
	"servings" double precision NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"progress" jsonb DEFAULT '{"checkedIngredients":[],"checkedSteps":[],"currentStep":0}'::jsonb NOT NULL,
	"rating" integer,
	"summary" text
);
--> statement-breakpoint
CREATE UNIQUE INDEX "cooking_sessions_workspace_id_idx" ON "cooking_sessions" USING btree ("workspace_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "recipe_versions_workspace_recipe_id_idx" ON "recipe_versions" USING btree ("workspace_id","recipe_id","id");--> statement-breakpoint
ALTER TABLE "photos" ADD COLUMN "session_id" uuid;--> statement-breakpoint
ALTER TABLE "cooking_session_notes" ADD CONSTRAINT "cooking_session_notes_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cooking_session_notes" ADD CONSTRAINT "cooking_notes_workspace_session_fk" FOREIGN KEY ("workspace_id","session_id") REFERENCES "public"."cooking_sessions"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cooking_sessions" ADD CONSTRAINT "cooking_sessions_started_by_user_id_users_id_fk" FOREIGN KEY ("started_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cooking_sessions" ADD CONSTRAINT "cooking_sessions_workspace_recipe_fk" FOREIGN KEY ("workspace_id","recipe_id") REFERENCES "public"."recipes"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cooking_sessions" ADD CONSTRAINT "cooking_sessions_exact_version_fk" FOREIGN KEY ("workspace_id","recipe_id","recipe_version_id") REFERENCES "public"."recipe_versions"("workspace_id","recipe_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cooking_notes_workspace_session_idx" ON "cooking_session_notes" USING btree ("workspace_id","session_id");--> statement-breakpoint

CREATE UNIQUE INDEX "cooking_sessions_active_idx" ON "cooking_sessions" USING btree ("workspace_id","recipe_id","started_by_user_id") WHERE "cooking_sessions"."status" = 'active';--> statement-breakpoint
CREATE INDEX "cooking_sessions_workspace_recipe_idx" ON "cooking_sessions" USING btree ("workspace_id","recipe_id","started_at");--> statement-breakpoint
ALTER TABLE "photos" ADD CONSTRAINT "photos_workspace_session_fk" FOREIGN KEY ("workspace_id","session_id") REFERENCES "public"."cooking_sessions"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "photos_workspace_session_idx" ON "photos" USING btree ("workspace_id","session_id");--> statement-breakpoint
