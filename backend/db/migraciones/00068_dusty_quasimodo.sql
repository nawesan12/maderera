-- Migración 0067 de drizzle (0067_dusty_quasimodo), pasada a goose el 24/10/2026.
-- Historia congelada: no se edita (ver backend/db/convertir-drizzle.py).

-- +goose Up
-- +goose StatementBegin
CREATE TABLE "rate_limits" (
	"clave" text NOT NULL,
	"ventana" timestamp with time zone NOT NULL,
	"cuenta" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "rate_limits_clave_ventana_pk" PRIMARY KEY("clave","ventana")
);
-- +goose StatementEnd
