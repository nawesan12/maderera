-- Migración 0053 de drizzle (0053_flimsy_guardian), pasada a goose el 24/10/2026.
-- Historia congelada: no se edita (ver backend/db/convertir-drizzle.py).

-- +goose Up
-- +goose StatementBegin
ALTER TABLE "cutting_orders" ADD COLUMN "acomodo_manual" text;
-- +goose StatementEnd
