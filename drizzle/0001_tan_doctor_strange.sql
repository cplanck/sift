CREATE TYPE "public"."recipe_status" AS ENUM('draft', 'active', 'archived');--> statement-breakpoint
CREATE TABLE "recipe_favorites" (
	"workspace_id" uuid NOT NULL,
	"recipe_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recipe_favorites_recipe_id_user_id_pk" PRIMARY KEY("recipe_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "recipe_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"recipe_id" uuid NOT NULL,
	"body" text NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recipe_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"recipe_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"content" jsonb NOT NULL,
	"change_summary" text NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recipes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"current_version_id" uuid,
	"status" "recipe_status" DEFAULT 'draft' NOT NULL,
	"source" jsonb NOT NULL,
	"cover_photo_id" uuid,
	"created_by_user_id" uuid,
	"updated_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- This supporting index must precede composite foreign keys.
CREATE UNIQUE INDEX "recipes_workspace_id_idx" ON "recipes" USING btree ("workspace_id","id");--> statement-breakpoint
ALTER TABLE "recipe_favorites" ADD CONSTRAINT "recipe_favorites_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_favorites" ADD CONSTRAINT "recipe_favorites_workspace_recipe_fk" FOREIGN KEY ("workspace_id","recipe_id") REFERENCES "public"."recipes"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_notes" ADD CONSTRAINT "recipe_notes_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_notes" ADD CONSTRAINT "recipe_notes_workspace_recipe_fk" FOREIGN KEY ("workspace_id","recipe_id") REFERENCES "public"."recipes"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_versions" ADD CONSTRAINT "recipe_versions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_versions" ADD CONSTRAINT "recipe_versions_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_versions" ADD CONSTRAINT "recipe_versions_workspace_recipe_fk" FOREIGN KEY ("workspace_id","recipe_id") REFERENCES "public"."recipes"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipes" ADD CONSTRAINT "recipes_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipes" ADD CONSTRAINT "recipes_current_version_id_recipe_versions_id_fk" FOREIGN KEY ("current_version_id") REFERENCES "public"."recipe_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipes" ADD CONSTRAINT "recipes_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipes" ADD CONSTRAINT "recipes_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "recipe_favorites_workspace_user_idx" ON "recipe_favorites" USING btree ("workspace_id","user_id");--> statement-breakpoint
CREATE INDEX "recipe_notes_workspace_recipe_idx" ON "recipe_notes" USING btree ("workspace_id","recipe_id");--> statement-breakpoint
CREATE UNIQUE INDEX "recipe_versions_number_idx" ON "recipe_versions" USING btree ("recipe_id","number");--> statement-breakpoint
CREATE INDEX "recipe_versions_workspace_recipe_idx" ON "recipe_versions" USING btree ("workspace_id","recipe_id");--> statement-breakpoint
CREATE INDEX "recipes_workspace_status_idx" ON "recipes" USING btree ("workspace_id","status","updated_at");