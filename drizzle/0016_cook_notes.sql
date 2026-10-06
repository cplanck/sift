ALTER TABLE "cooking_session_notes" ADD COLUMN "organized_body" text;--> statement-breakpoint
ALTER TABLE "cooking_session_notes" ADD COLUMN "wrap_up" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "cooking_session_notes" ADD COLUMN "cleanup_status" text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "cooking_session_notes" ADD COLUMN "cleanup_dispatched_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "cooking_session_notes" ADD COLUMN "cleanup_started_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "cooking_notes_wrap_up_idx" ON "cooking_session_notes" USING btree ("session_id") WHERE "cooking_session_notes"."wrap_up" = true;