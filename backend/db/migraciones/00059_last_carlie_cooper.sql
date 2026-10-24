-- Migración 0058 de drizzle (0058_last_carlie_cooper), pasada a goose el 24/10/2026.
-- Historia congelada: no se edita (ver backend/db/convertir-drizzle.py).

-- +goose Up
-- +goose StatementBegin
CREATE TYPE "public"."mitad_placa" AS ENUM('largo', 'ancho');
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE "cutting_orders" ADD COLUMN "placa_largo_mm" integer;
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE "cutting_orders" ADD COLUMN "placa_ancho_mm" integer;
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE "cutting_orders" ADD COLUMN "mitad" "mitad_placa";
-- +goose StatementEnd
