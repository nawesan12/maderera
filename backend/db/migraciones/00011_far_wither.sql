-- Migración 0010 de drizzle (0010_far_wither), pasada a goose el 24/10/2026.
-- Historia congelada: no se edita (ver backend/db/convertir-drizzle.py).

-- +goose Up
-- +goose StatementBegin
CREATE TYPE "public"."estado_reserva" AS ENUM('activa', 'consumida', 'liberada');
-- +goose StatementEnd
-- +goose StatementBegin
CREATE TABLE "stock_reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"order_item_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"cantidad" integer NOT NULL,
	"estado" "estado_reserva" DEFAULT 'activa' NOT NULL,
	"resuelto_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE restrict ON UPDATE no action;
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE restrict ON UPDATE no action;
-- +goose StatementEnd
-- +goose StatementBegin
CREATE INDEX "stock_reservations_order_idx" ON "stock_reservations" USING btree ("order_id");
-- +goose StatementEnd
-- +goose StatementBegin
CREATE INDEX "stock_reservations_item_idx" ON "stock_reservations" USING btree ("order_item_id");
-- +goose StatementEnd
-- +goose StatementBegin
CREATE INDEX "stock_reservations_activa_idx" ON "stock_reservations" USING btree ("variant_id","branch_id","estado");
-- +goose StatementEnd
