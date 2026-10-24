-- Migración 0059 de drizzle (0059_sweet_shinko_yamashiro), pasada a goose el 24/10/2026.
-- Historia congelada: no se edita (ver backend/db/convertir-drizzle.py).

-- +goose Up
-- +goose StatementBegin
CREATE TABLE "cart_cortes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cart_id" uuid NOT NULL,
	"variant_id" uuid,
	"material_descripcion" text NOT NULL,
	"placa_largo_mm" integer NOT NULL,
	"placa_ancho_mm" integer NOT NULL,
	"mitad" text,
	"canto_descripcion" text,
	"piezas" text NOT NULL,
	"placas" integer DEFAULT 1 NOT NULL,
	"pasadas" integer DEFAULT 0 NOT NULL,
	"total" numeric(12, 2) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE "cart_cortes" ADD CONSTRAINT "cart_cortes_cart_id_carts_id_fk" FOREIGN KEY ("cart_id") REFERENCES "public"."carts"("id") ON DELETE cascade ON UPDATE no action;
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE "cart_cortes" ADD CONSTRAINT "cart_cortes_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE cascade ON UPDATE no action;
-- +goose StatementEnd
-- +goose StatementBegin
CREATE INDEX "cart_cortes_cart_idx" ON "cart_cortes" USING btree ("cart_id");
-- +goose StatementEnd
