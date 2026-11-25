-- Migración 0070 de drizzle (0070_low_bloodstorm), pasada a goose el 24/10/2026.
-- Historia congelada: no se edita (ver backend/db/convertir-drizzle.py).

-- +goose Up
-- +goose StatementBegin
ALTER TABLE "invoice_payments" ADD COLUMN "receipt_id" uuid;
-- +goose StatementEnd
