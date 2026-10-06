CREATE TABLE "cover_daily_budgets" (
	"workspace_id" uuid NOT NULL,
	"day" text NOT NULL,
	"committed_usd" numeric(20, 10) NOT NULL,
	CONSTRAINT "cover_daily_budgets_workspace_id_day_pk" PRIMARY KEY("workspace_id","day")
);
--> statement-breakpoint
ALTER TABLE "cover_daily_budgets" ADD CONSTRAINT "cover_daily_budgets_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;