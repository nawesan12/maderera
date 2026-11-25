-- Migración 0023 de drizzle (0023_open_tombstone), pasada a goose el 24/10/2026.
-- Historia congelada: no se edita (ver backend/db/convertir-drizzle.py).

-- +goose Up
-- +goose StatementBegin
CREATE TABLE "pos_devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"codigo" text NOT NULL,
	"nombre" text,
	"branch_id" uuid,
	"secreto" text NOT NULL,
	"activo" boolean DEFAULT true NOT NULL,
	"ultima_vez_at" timestamp with time zone,
	"pendientes" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE "orders" ADD COLUMN "numero_provisorio" text;
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE "orders" ADD COLUMN "cobrada_at" timestamp with time zone;
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE "orders" ADD COLUMN "sincronizada_at" timestamp with time zone;
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE "cash_movements" ADD COLUMN "clave" text;
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE "pos_devices" ADD CONSTRAINT "pos_devices_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;
-- +goose StatementEnd
-- +goose StatementBegin
CREATE UNIQUE INDEX "pos_devices_codigo_idx" ON "pos_devices" USING btree ("codigo");
-- +goose StatementEnd
-- +goose StatementBegin
CREATE UNIQUE INDEX "orders_numero_provisorio_idx" ON "orders" USING btree ("numero_provisorio");
-- +goose StatementEnd
-- +goose StatementBegin
CREATE UNIQUE INDEX "cash_movements_clave_idx" ON "cash_movements" USING btree ("clave");
-- +goose StatementEnd
