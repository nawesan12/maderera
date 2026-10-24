-- Migración 0055 de drizzle (0055_huge_captain_universe), pasada a goose el 24/10/2026.
-- Historia congelada: no se edita (ver backend/db/convertir-drizzle.py).

-- +goose Up
-- +goose StatementBegin
ALTER TABLE "order_payments" ADD COLUMN "cuotas" integer DEFAULT 1 NOT NULL;
-- +goose StatementEnd
