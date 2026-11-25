-- Migración 0001 de drizzle (0001_bouncy_winter_soldier), pasada a goose el 24/10/2026.
-- Historia congelada: no se edita (ver backend/db/convertir-drizzle.py).

-- +goose Up
-- +goose StatementBegin
ALTER TABLE "account" ADD COLUMN "issuer" text NOT NULL;
-- +goose StatementEnd
