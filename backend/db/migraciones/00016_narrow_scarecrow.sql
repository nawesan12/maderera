-- Migración 0015 de drizzle (0015_narrow_scarecrow), pasada a goose el 24/10/2026.
-- Historia congelada: no se edita (ver backend/db/convertir-drizzle.py).

-- +goose Up
-- +goose StatementBegin
CREATE TYPE "public"."accion_auditoria" AS ENUM('crear', 'editar', 'eliminar', 'cambiar_estado', 'cobrar', 'anular', 'importar', 'exportar');
-- +goose StatementEnd
-- +goose StatementBegin
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"usuario_id" text,
	"usuario_nombre" text NOT NULL,
	"usuario_email" text,
	"usuario_rol" text,
	"accion" "accion_auditoria" NOT NULL,
	"entidad" text NOT NULL,
	"entidad_id" text,
	"descripcion" text NOT NULL,
	"detalle" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
-- +goose StatementEnd
-- +goose StatementBegin
CREATE INDEX "audit_log_fecha_idx" ON "audit_log" USING btree ("created_at");
-- +goose StatementEnd
-- +goose StatementBegin
CREATE INDEX "audit_log_entidad_idx" ON "audit_log" USING btree ("entidad","entidad_id");
-- +goose StatementEnd
-- +goose StatementBegin
CREATE INDEX "audit_log_usuario_idx" ON "audit_log" USING btree ("usuario_id");
-- +goose StatementEnd
