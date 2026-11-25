-- Migración 0057 de drizzle (0057_majestic_black_knight), pasada a goose el 24/10/2026.
-- Historia congelada: no se edita (ver backend/db/convertir-drizzle.py).

-- +goose Up
-- +goose StatementBegin
ALTER TABLE "bank_promotions" ADD COLUMN "imagen_url" text;
-- +goose StatementEnd
