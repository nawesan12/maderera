-- Migración 0051 de drizzle (0051_typical_nuke), pasada a goose el 24/10/2026.
-- Historia congelada: no se edita (ver backend/db/convertir-drizzle.py).

-- +goose Up
-- +goose StatementBegin
CREATE TYPE "public"."circuito" AS ENUM('blanco', 'negro');
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE "supplier_payments" ADD COLUMN "circuito" "circuito" DEFAULT 'blanco' NOT NULL;
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE "expenses" ADD COLUMN "circuito" "circuito" DEFAULT 'blanco' NOT NULL;
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE "cheques" ADD COLUMN "circuito" "circuito" DEFAULT 'blanco' NOT NULL;
-- +goose StatementEnd
-- +goose StatementBegin
CREATE INDEX "supplier_payments_circuito_idx" ON "supplier_payments" USING btree ("circuito","fecha");
-- +goose StatementEnd
-- +goose StatementBegin
CREATE INDEX "expenses_circuito_idx" ON "expenses" USING btree ("circuito","fecha");
-- +goose StatementEnd
-- +goose StatementBegin
CREATE INDEX "cheques_circuito_idx" ON "cheques" USING btree ("circuito","fecha_pago");
-- +goose StatementEnd
