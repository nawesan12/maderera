-- Migración 0056 de drizzle (0056_skinny_otto_octavius), pasada a goose el 24/10/2026.
-- Historia congelada: no se edita (ver backend/db/convertir-drizzle.py).

-- +goose Up
-- +goose StatementBegin
ALTER TYPE "public"."estado_corte" ADD VALUE 'cancelado';
-- +goose StatementEnd
