-- Migración 0002 de drizzle (0002_unaccent), pasada a goose el 24/10/2026.
-- Historia congelada: no se edita (ver backend/db/convertir-drizzle.py).

-- +goose Up
-- +goose StatementBegin
-- Búsqueda sin acentos.
--
-- La usa `lib/busqueda.ts`: quien escribe "fenolico" tiene que encontrar
-- "Fenólico". unaccent viene con Postgres y está disponible en Neon, así que no
-- agrega dependencias de infraestructura.
CREATE EXTENSION IF NOT EXISTS unaccent;
-- +goose StatementEnd
