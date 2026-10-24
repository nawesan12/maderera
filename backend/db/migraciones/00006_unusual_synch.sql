-- Migración 0005 de drizzle (0005_unusual_synch), pasada a goose el 24/10/2026.
-- Historia congelada: no se edita (ver backend/db/convertir-drizzle.py).

-- +goose Up
-- +goose StatementBegin
ALTER TABLE "price_list_items" ADD COLUMN "precio_anterior" numeric(12, 2);
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE "price_list_items" ADD COLUMN "oferta_hasta" timestamp with time zone;
-- +goose StatementEnd
