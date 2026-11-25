-- Migración 0014 de drizzle (0014_yielding_celestials), pasada a goose el 24/10/2026.
-- Historia congelada: no se edita (ver backend/db/convertir-drizzle.py).

-- +goose Up
-- +goose StatementBegin
ALTER TABLE "branches" ADD COLUMN "servicios" text DEFAULT '' NOT NULL;
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE "branches" ADD COLUMN "destacados" text DEFAULT '' NOT NULL;
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE "branches" ADD COLUMN "imagen_url" text;
-- +goose StatementEnd
