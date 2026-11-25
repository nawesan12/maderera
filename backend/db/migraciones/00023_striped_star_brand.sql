-- Migración 0022 de drizzle (0022_striped_star_brand), pasada a goose el 24/10/2026.
-- Historia congelada: no se edita (ver backend/db/convertir-drizzle.py).

-- +goose Up
-- +goose StatementBegin
ALTER TABLE "orders" ADD COLUMN "descuento" numeric(12, 2) DEFAULT '0' NOT NULL;
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE "orders" ADD COLUMN "descuento_motivo" text;
-- +goose StatementEnd
