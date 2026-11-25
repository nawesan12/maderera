-- Migración 0075 de drizzle (0075_glorious_violations), pasada a goose el 24/10/2026.
-- Historia congelada: no se edita (ver backend/db/convertir-drizzle.py).

-- +goose Up
-- +goose StatementBegin
ALTER TABLE "cutting_orders" ADD COLUMN "motor_plano" integer DEFAULT 2 NOT NULL;
-- +goose StatementEnd
-- +goose StatementBegin
-- Los que ya existen se armaron (y se cobraron) con el motor anterior.
UPDATE "cutting_orders" SET "motor_plano" = 1;
-- +goose StatementEnd
