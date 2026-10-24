-- Migración 0038 de drizzle (0038_late_marvel_apes), pasada a goose el 24/10/2026.
-- Historia congelada: no se edita (ver backend/db/convertir-drizzle.py).

-- +goose Up
-- +goose StatementBegin
CREATE TYPE "public"."ubicacion_banner" AS ENUM('franja', 'portada', 'catalogo');
-- +goose StatementEnd
-- +goose StatementBegin
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
-- +goose StatementEnd
-- +goose StatementBegin
CREATE INDEX "banners_ubicacion_idx" ON "banners" USING btree ("ubicacion","activo","orden");
-- +goose StatementEnd
