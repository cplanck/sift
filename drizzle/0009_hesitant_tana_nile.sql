CREATE TABLE "voice_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"auth_session_id" uuid,
	"conversation_id" uuid,
	"provider_conversation_id" text,
	"agent_id" text,
	"status" text DEFAULT 'preparing' NOT NULL,
	"context" jsonb NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"lease_expires_at" timestamp with time zone NOT NULL,
	"active_run_id" uuid,
	"last_user_count" integer DEFAULT 0 NOT NULL,
	"last_provider_turn" integer DEFAULT -1 NOT NULL,
	"last_fingerprint" text,
	"duration_seconds" integer,
	"cost_usd" numeric(20, 10),
	"credits" bigint,
	"usage_status" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "voice_sessions_provider_conversation_id_unique" UNIQUE("provider_conversation_id")
);
--> statement-breakpoint
CREATE TABLE "voice_turns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"voice_session_id" uuid NOT NULL,
	"fingerprint" text NOT NULL,
	"provider_turn" integer NOT NULL,
	"user_count" integer NOT NULL,
	"run_id" uuid,
	"status" text NOT NULL,
	"response_text" text,
	"requires_approval" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "voice_sessions" ADD CONSTRAINT "voice_sessions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_sessions" ADD CONSTRAINT "voice_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_sessions" ADD CONSTRAINT "voice_sessions_auth_session_id_sessions_id_fk" FOREIGN KEY ("auth_session_id") REFERENCES "public"."sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_sessions" ADD CONSTRAINT "voice_sessions_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_sessions" ADD CONSTRAINT "voice_sessions_active_run_id_conversation_turns_id_fk" FOREIGN KEY ("active_run_id") REFERENCES "public"."conversation_turns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_turns" ADD CONSTRAINT "voice_turns_voice_session_id_voice_sessions_id_fk" FOREIGN KEY ("voice_session_id") REFERENCES "public"."voice_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_turns" ADD CONSTRAINT "voice_turns_run_id_conversation_turns_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."conversation_turns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "voice_sessions_user_conversation_idx" ON "voice_sessions" USING btree ("workspace_id","user_id","conversation_id");--> statement-breakpoint
CREATE INDEX "voice_sessions_auth_session_idx" ON "voice_sessions" USING btree ("auth_session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "voice_turns_fingerprint_idx" ON "voice_turns" USING btree ("voice_session_id","fingerprint");--> statement-breakpoint
CREATE INDEX "voice_turns_run_idx" ON "voice_turns" USING btree ("run_id");