-- Migración 0035 de drizzle (0035_redundant_yellowjacket), pasada a goose el 24/10/2026.
-- Historia congelada: no se edita (ver backend/db/convertir-drizzle.py).

-- +goose Up
-- +goose StatementBegin
ALTER TABLE "branches" DROP COLUMN "address";
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE "branches" DROP COLUMN "phone";
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE "branches" DROP COLUMN "whatsapp";
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE "branches" DROP COLUMN "email";
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE "branches" DROP COLUMN "hours";
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE "branches" DROP COLUMN "map_url";
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE "branches" DROP COLUMN "servicios";
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE "branches" DROP COLUMN "destacados";
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE "branches" DROP COLUMN "imagen_url";
-- +goose StatementEnd
