-- Migración 0037 de drizzle (0037_sour_electro), pasada a goose el 24/10/2026.
-- Historia congelada: no se edita (ver backend/db/convertir-drizzle.py).

-- +goose Up
-- +goose StatementBegin
ALTER TABLE "product_variants" ADD COLUMN "terminacion" text;
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE "product_variants" ADD COLUMN "calidad" text;
-- +goose StatementEnd
