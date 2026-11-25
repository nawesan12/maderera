-- Migración 0071 de drizzle (0071_secret_infant_terrible), pasada a goose el 24/10/2026.
-- Historia congelada: no se edita (ver backend/db/convertir-drizzle.py).

-- +goose Up
-- +goose StatementBegin
ALTER TYPE "public"."medio_pago" ADD VALUE IF NOT EXISTS 'cheque';
-- +goose StatementEnd
