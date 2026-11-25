-- Migración 0039 de drizzle (0039_majestic_dagger), pasada a goose el 24/10/2026.
-- Historia congelada: no se edita (ver backend/db/convertir-drizzle.py).

-- +goose Up
-- +goose StatementBegin
ALTER TABLE "banners" ADD COLUMN "etiqueta" text DEFAULT '' NOT NULL;
-- +goose StatementEnd
