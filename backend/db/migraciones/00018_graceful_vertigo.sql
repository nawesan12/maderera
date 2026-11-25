-- Migración 0017 de drizzle (0017_graceful_vertigo), pasada a goose el 24/10/2026.
-- Historia congelada: no se edita (ver backend/db/convertir-drizzle.py).

-- +goose Up
-- +goose StatementBegin
CREATE TABLE "cutting_export_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nombre" text NOT NULL,
	"programa" text,
	"separador" text DEFAULT ';' NOT NULL,
	"con_encabezado" boolean DEFAULT true NOT NULL,
	"unidad" text DEFAULT 'mm' NOT NULL,
	"decimal" text DEFAULT ',' NOT NULL,
	"valor_si" text DEFAULT 'Sí' NOT NULL,
	"valor_no" text DEFAULT 'No' NOT NULL,
	"fin_de_linea" text DEFAULT 'crlf' NOT NULL,
	"columnas" text NOT NULL,
	"por_defecto" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
-- +goose StatementEnd
-- +goose StatementBegin
CREATE UNIQUE INDEX "cutting_export_profiles_nombre_idx" ON "cutting_export_profiles" USING btree ("nombre");
-- +goose StatementEnd
