-- Migración 0031 de drizzle (0031_caja_gasto), pasada a goose el 24/10/2026.
-- Historia congelada: no se edita (ver backend/db/convertir-drizzle.py).

-- +goose Up
-- +goose StatementBegin
ALTER TABLE "cash_movements" ADD COLUMN "expense_id" uuid;
-- +goose StatementEnd
