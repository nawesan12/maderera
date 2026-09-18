CREATE TYPE "public"."origen_resena" AS ENUM('manual', 'google');--> statement-breakpoint
CREATE TABLE "business_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"autor" text NOT NULL,
	"estrellas" integer NOT NULL,
	"texto" text NOT NULL,
	"fecha" timestamp with time zone DEFAULT now() NOT NULL,
	"origen" "origen_resena" DEFAULT 'manual' NOT NULL,
	"externo_id" text,
	"foto_url" text,
	"publicada" boolean DEFAULT false NOT NULL,
	"orden" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "business_reviews_publicada_idx" ON "business_reviews" USING btree ("publicada","orden");--> statement-breakpoint
CREATE UNIQUE INDEX "business_reviews_externo_idx" ON "business_reviews" USING btree ("externo_id");