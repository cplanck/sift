CREATE TABLE "recipe_stock_photos" (
	"recipe_id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"photo" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "recipe_stock_photos" ADD CONSTRAINT "recipe_stock_photos_workspace_recipe_fk" FOREIGN KEY ("workspace_id","recipe_id") REFERENCES "public"."recipes"("workspace_id","id") ON DELETE cascade ON UPDATE no action;