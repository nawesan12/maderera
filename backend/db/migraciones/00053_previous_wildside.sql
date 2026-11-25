-- Migración 0052 de drizzle (0052_previous_wildside), pasada a goose el 24/10/2026.
-- Historia congelada: no se edita (ver backend/db/convertir-drizzle.py).

-- +goose Up
-- +goose StatementBegin
ALTER TABLE "products" ADD COLUMN "imputacion" text;
-- +goose StatementEnd
-- +goose StatementBegin
CREATE INDEX "products_imputacion_idx" ON "products" USING btree ("imputacion");
-- +goose StatementEnd
