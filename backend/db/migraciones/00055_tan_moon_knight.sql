-- Migración 0054 de drizzle (0054_tan_moon_knight), pasada a goose el 24/10/2026.
-- Historia congelada: no se edita (ver backend/db/convertir-drizzle.py).

-- +goose Up
-- +goose StatementBegin
CREATE TYPE "public"."quien_paga_promo" AS ENUM('banco', 'nosotros');
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE "bank_promotions" ADD COLUMN "quien_paga" "quien_paga_promo" DEFAULT 'banco' NOT NULL;
-- +goose StatementEnd
