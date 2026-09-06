CREATE TYPE "public"."ubicacion_banner" AS ENUM('franja', 'portada', 'catalogo');--> statement-breakpoint
CREATE TABLE "banners" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ubicacion" "ubicacion_banner" NOT NULL,
	"titulo" text NOT NULL,
	"bajada" text DEFAULT '' NOT NULL,
	"enlace" text,
	"texto_enlace" text DEFAULT '' NOT NULL,
	"imagen_url" text,
	"desde" timestamp with time zone,
	"hasta" timestamp with time zone,
	"orden" integer DEFAULT 0 NOT NULL,
	"activo" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "banners_ubicacion_idx" ON "banners" USING btree ("ubicacion","activo","orden");