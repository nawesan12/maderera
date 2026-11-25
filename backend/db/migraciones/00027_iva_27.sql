-- Migración 0026 de drizzle (0026_iva_27), pasada a goose el 24/10/2026.
-- Historia congelada: no se edita (ver backend/db/convertir-drizzle.py).

-- +goose Up
-- +goose StatementBegin
ALTER TABLE "invoices" ADD COLUMN "iva27" numeric(12, 2) DEFAULT '0' NOT NULL;
-- +goose StatementEnd
