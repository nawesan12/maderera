-- Migración 0021 de drizzle (0021_simple_nicolaos), pasada a goose el 24/10/2026.
-- Historia congelada: no se edita (ver backend/db/convertir-drizzle.py).

-- +goose Up
-- +goose StatementBegin
ALTER TYPE "public"."proveedor_pago" ADD VALUE 'mostrador' BEFORE 'demo';
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TYPE "public"."medio_pago" ADD VALUE 'debito' BEFORE 'cuenta_corriente';
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TYPE "public"."medio_pago" ADD VALUE 'credito' BEFORE 'cuenta_corriente';
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE "orders" ADD COLUMN "clave_mostrador" text;
-- +goose StatementEnd
-- +goose StatementBegin
CREATE UNIQUE INDEX "orders_clave_mostrador_idx" ON "orders" USING btree ("clave_mostrador");
-- +goose StatementEnd
