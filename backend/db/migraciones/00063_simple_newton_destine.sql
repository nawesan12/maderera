-- Migración 0062 de drizzle (0062_simple_newton_destine), pasada a goose el 24/10/2026.
-- Historia congelada: no se edita (ver backend/db/convertir-drizzle.py).

-- +goose Up
-- +goose StatementBegin
ALTER TYPE "public"."rubro_profesional" ADD VALUE 'cementista' BEFORE 'disenador';
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TYPE "public"."rubro_profesional" ADD VALUE 'moldava' BEFORE 'disenador';
-- +goose StatementEnd
