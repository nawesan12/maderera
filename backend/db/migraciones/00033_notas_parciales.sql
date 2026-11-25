-- Migración 0032 de drizzle (0032_notas_parciales), pasada a goose el 24/10/2026.
-- Historia congelada: no se edita (ver backend/db/convertir-drizzle.py).

-- +goose Up
-- +goose StatementBegin
ALTER TABLE "invoice_items" ADD COLUMN "invoice_item_origen_id" uuid;
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE "invoices" ADD COLUMN "acreditado" numeric(12, 2) DEFAULT '0' NOT NULL;
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE "invoices" ADD COLUMN "debitado" numeric(12, 2) DEFAULT '0' NOT NULL;
-- +goose StatementEnd
-- +goose StatementBegin
CREATE INDEX "invoice_items_origen_idx" ON "invoice_items" USING btree ("invoice_item_origen_id");
-- +goose StatementEnd
