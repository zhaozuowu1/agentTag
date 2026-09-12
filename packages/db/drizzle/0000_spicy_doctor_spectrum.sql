CREATE TABLE "audit_events" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_key" text NOT NULL,
	"open_id" text NOT NULL,
	"chat_id" text NOT NULL,
	"session_id" text,
	"tool_name" text NOT NULL,
	"target_host" text,
	"success" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "authorized_chats" (
	"tenant_key" text NOT NULL,
	"chat_id" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"chat_type" text NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "authorized_chats_tenant_key_chat_id_pk" PRIMARY KEY("tenant_key","chat_id")
);
--> statement-breakpoint
CREATE TABLE "memory_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_key" text NOT NULL,
	"scope" text NOT NULL,
	"chat_id" text,
	"kind" text NOT NULL,
	"text" text NOT NULL,
	"source_session_id" text,
	"created_by_open_id" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenants" (
	"tenant_key" text PRIMARY KEY NOT NULL,
	"display_name" text DEFAULT '' NOT NULL,
	"monthly_limit_usd" numeric DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usage_events" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_key" text NOT NULL,
	"chat_id" text NOT NULL,
	"session_id" text NOT NULL,
	"open_id" text NOT NULL,
	"input_tokens" integer NOT NULL,
	"output_tokens" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "working_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_key" text NOT NULL,
	"chat_id" text NOT NULL,
	"thread_id" text,
	"root_message_id" text NOT NULL,
	"kind" text NOT NULL,
	"status" text NOT NULL,
	"access_bundle_ids" text[] DEFAULT '{}' NOT NULL,
	"checklist_message_id" text,
	"sandbox_id" text,
	"started_by_open_id" text NOT NULL,
	"transcript" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_activity_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_tenant_key_tenants_tenant_key_fk" FOREIGN KEY ("tenant_key") REFERENCES "public"."tenants"("tenant_key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "authorized_chats" ADD CONSTRAINT "authorized_chats_tenant_key_tenants_tenant_key_fk" FOREIGN KEY ("tenant_key") REFERENCES "public"."tenants"("tenant_key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_entries" ADD CONSTRAINT "memory_entries_tenant_key_tenants_tenant_key_fk" FOREIGN KEY ("tenant_key") REFERENCES "public"."tenants"("tenant_key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_tenant_key_tenants_tenant_key_fk" FOREIGN KEY ("tenant_key") REFERENCES "public"."tenants"("tenant_key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "working_sessions" ADD CONSTRAINT "working_sessions_tenant_key_tenants_tenant_key_fk" FOREIGN KEY ("tenant_key") REFERENCES "public"."tenants"("tenant_key") ON DELETE no action ON UPDATE no action;