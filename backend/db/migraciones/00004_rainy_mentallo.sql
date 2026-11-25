-- Migración 0003 de drizzle (0003_rainy_mentallo), pasada a goose el 24/10/2026.
-- Historia congelada: no se edita (ver backend/db/convertir-drizzle.py).

-- +goose Up
-- +goose StatementBegin
CREATE TYPE "public"."price_change_source" AS ENUM('manual', 'ajuste_masivo', 'importacion');
-- +goose StatementEnd
-- +goose StatementBegin
CREATE TABLE "price_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"variant_id" uuid NOT NULL,
	"price_list_id" uuid NOT NULL,
	"precio_anterior" numeric(12, 2),
	"precio_nuevo" numeric(12, 2) NOT NULL,
	"origen" "price_change_source" NOT NULL,
	"motivo" text,
	"lote_id" uuid,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE "price_history" ADD CONSTRAINT "price_history_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE cascade ON UPDATE no action;
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE "price_history" ADD CONSTRAINT "price_history_price_list_id_price_lists_id_fk" FOREIGN KEY ("price_list_id") REFERENCES "public"."price_lists"("id") ON DELETE cascade ON UPDATE no action;
-- +goose StatementEnd
-- +goose StatementBegin
CREATE INDEX "price_history_variant_idx" ON "price_history" USING btree ("variant_id");
-- +goose StatementEnd
-- +goose StatementBegin
CREATE INDEX "price_history_lote_idx" ON "price_history" USING btree ("lote_id");
-- +goose StatementEnd
-- +goose StatementBegin
CREATE INDEX "price_history_created_idx" ON "price_history" USING btree ("created_at");
-- +goose StatementEnd
