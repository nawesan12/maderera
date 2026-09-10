CREATE TABLE "bank_promotions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"medio" text NOT NULL,
	"titulo" text NOT NULL,
	"detalle" text DEFAULT '' NOT NULL,
	"dias" text DEFAULT '' NOT NULL,
	"vigencia_hasta" timestamp with time zone,
	"orden" integer DEFAULT 0 NOT NULL,
	"activo" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "bank_promotions_activo_idx" ON "bank_promotions" USING btree ("activo","orden");