-- Migración 0072 de drizzle (0072_famous_masque), pasada a goose el 24/10/2026.
-- Historia congelada: no se edita (ver backend/db/convertir-drizzle.py).

-- +goose Up
-- +goose StatementBegin
ALTER TABLE "calculator_settings" ALTER COLUMN "ancho_sierra_mm" SET DATA TYPE numeric(4, 1);
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE "calculator_settings" ALTER COLUMN "ancho_sierra_mm" SET DEFAULT 5;
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE "cutting_orders" ADD COLUMN "ancho_sierra_mm" numeric(4, 1) DEFAULT 5 NOT NULL;
-- +goose StatementEnd
-- +goose StatementBegin
-- Los trabajos que ya existen se quedan con el disco que había configurado al
-- migrar: así el plano y el precio de un corte viejo no cambian el día que
-- alguien toque la configuración.
UPDATE "cutting_orders" SET "ancho_sierra_mm" = coalesce((SELECT "ancho_sierra_mm" FROM "calculator_settings" LIMIT 1), 5);
-- +goose StatementEnd
