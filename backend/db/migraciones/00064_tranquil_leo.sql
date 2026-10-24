-- Migración 0063 de drizzle (0063_tranquil_leo), pasada a goose el 24/10/2026.
-- Historia congelada: no se edita (ver backend/db/convertir-drizzle.py).

-- +goose Up
-- +goose StatementBegin
ALTER TABLE "customers" ADD COLUMN "dias_credito" integer DEFAULT 30 NOT NULL;
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE "customers" ADD COLUMN "cuenta_bloqueada" boolean DEFAULT false NOT NULL;
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE "customers" ADD COLUMN "motivo_bloqueo" text;
-- +goose StatementEnd
