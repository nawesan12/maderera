-- Migración 0060 de drizzle (0060_normal_prodigy), pasada a goose el 24/10/2026.
-- Historia congelada: no se edita (ver backend/db/convertir-drizzle.py).

-- +goose Up
-- +goose StatementBegin
ALTER TABLE "branches" ADD COLUMN "fondo_base" numeric(12, 2) DEFAULT '0' NOT NULL;
-- +goose StatementEnd
