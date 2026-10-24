-- Migración 0048 de drizzle (0048_conscious_solo), pasada a goose el 24/10/2026.
-- Historia congelada: no se edita (ver backend/db/convertir-drizzle.py).

-- +goose Up
-- +goose StatementBegin
ALTER TABLE "cutting_items" ADD COLUMN "aclaracion" text;
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE "cutting_orders" ADD COLUMN "canto_descripcion" text;
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE "cutting_rates" ADD COLUMN "precio_por_metro_canto" numeric(12, 2) DEFAULT '0' NOT NULL;
-- +goose StatementEnd
