-- Migración 0034 de drizzle (0034_bumpy_pandemic), pasada a goose el 24/10/2026.
-- Historia congelada: no se edita (ver backend/db/convertir-drizzle.py).

-- +goose Up
-- +goose StatementBegin
CREATE UNIQUE INDEX "cutting_rates_material_general_idx" ON "cutting_rates" USING btree ("material") WHERE "cutting_rates"."price_list_id" is null;
-- +goose StatementEnd
