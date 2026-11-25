-- Migración 0036 de drizzle (0036_brief_jackal), pasada a goose el 24/10/2026.
-- Historia congelada: no se edita (ver backend/db/convertir-drizzle.py).

-- +goose Up
-- +goose StatementBegin
ALTER TABLE "cutting_orders" ADD COLUMN "pasadas" integer DEFAULT 0 NOT NULL;
-- +goose StatementEnd
