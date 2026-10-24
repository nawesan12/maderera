-- Migración 0040 de drizzle (0040_aspiring_zaladane), pasada a goose el 24/10/2026.
-- Historia congelada: no se edita (ver backend/db/convertir-drizzle.py).

-- +goose Up
-- +goose StatementBegin
CREATE TYPE "public"."tipo_documento" AS ENUM('dni', 'cuit');
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TYPE "public"."rubro_profesional" ADD VALUE 'woodframer' BEFORE 'otro';
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE "professional_applications" ALTER COLUMN "cuit" DROP NOT NULL;
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE "professional_applications" ADD COLUMN "documento_tipo" "tipo_documento" DEFAULT 'cuit' NOT NULL;
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE "professional_applications" ADD COLUMN "documento_numero" text;
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE "professional_applications" ADD COLUMN "red_social" text;
-- +goose StatementEnd
-- +goose StatementBegin
UPDATE "professional_applications" SET "documento_numero" = "cuit" WHERE "documento_numero" IS NULL;
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE "professional_applications" ALTER COLUMN "documento_numero" SET NOT NULL;
-- +goose StatementEnd
-- +goose StatementBegin
CREATE INDEX "professional_applications_documento_idx" ON "professional_applications" USING btree ("documento_numero");
-- +goose StatementEnd
