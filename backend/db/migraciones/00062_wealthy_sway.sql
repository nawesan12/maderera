-- Migración 0061 de drizzle (0061_wealthy_sway), pasada a goose el 24/10/2026.
-- Historia congelada: no se edita (ver backend/db/convertir-drizzle.py).

-- +goose Up
-- +goose StatementBegin
ALTER TABLE "regimenes_retencion" ADD COLUMN "jurisdiccion" text;
-- +goose StatementEnd
