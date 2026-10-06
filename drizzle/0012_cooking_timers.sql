CREATE TABLE "cooking_timers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"label" text NOT NULL,
	"step_key" text,
	"duration_seconds" integer NOT NULL,
	"remaining_ms" bigint NOT NULL,
	"due_at" timestamp with time zone,
	"status" text DEFAULT 'running' NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cooking_timers" ADD CONSTRAINT "cooking_timers_workspace_session_fk" FOREIGN KEY ("workspace_id","session_id") REFERENCES "public"."cooking_sessions"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cooking_timers_session_idx" ON "cooking_timers" USING btree ("workspace_id","session_id");