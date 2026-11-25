-- Migración 0018 de drizzle (0018_tranquil_ravenous), pasada a goose el 24/10/2026.
-- Historia congelada: no se edita (ver backend/db/convertir-drizzle.py).

-- +goose Up
-- +goose StatementBegin
ALTER TYPE "public"."staff_role" ADD VALUE 'aserradero';
-- +goose StatementEnd
