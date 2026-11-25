-- Migración 0049 de drizzle (0049_slippery_professor_monster), pasada a goose el 24/10/2026.
-- Historia congelada: no se edita (ver backend/db/convertir-drizzle.py).

-- +goose Up
-- +goose StatementBegin
ALTER TABLE "products" ADD COLUMN "recargo_elaboracion_pct" numeric(6, 2);
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE "price_lists" ADD COLUMN "porcentaje_sobre_general" numeric(6, 2);
-- +goose StatementEnd
