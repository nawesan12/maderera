-- Migración 0065 de drizzle (0065_supreme_lord_hawal), pasada a goose el 24/10/2026.
-- Historia congelada: no se edita (ver backend/db/convertir-drizzle.py).

-- +goose Up
-- +goose StatementBegin
CREATE TYPE "public"."origen_resena" AS ENUM('manual', 'google');
-- +goose StatementEnd
-- +goose StatementBegin
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
-- +goose StatementEnd
-- +goose StatementBegin
CREATE INDEX "business_reviews_publicada_idx" ON "business_reviews" USING btree ("publicada","orden");
-- +goose StatementEnd
-- +goose StatementBegin
CREATE UNIQUE INDEX "business_reviews_externo_idx" ON "business_reviews" USING btree ("externo_id");
-- +goose StatementEnd
