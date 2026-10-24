-- Migración 0024 de drizzle (0024_proveedores), pasada a goose el 24/10/2026.
-- Historia congelada: no se edita (ver backend/db/convertir-drizzle.py).

-- +goose Up
-- +goose StatementBegin
CREATE TYPE "public"."estado_proveedor" AS ENUM('activo', 'inactivo');
-- +goose StatementEnd
-- +goose StatementBegin
CREATE TYPE "public"."tipo_movimiento_proveedor" AS ENUM('factura', 'pago', 'nota_credito', 'nota_debito', 'ajuste');
-- +goose StatementEnd
-- +goose StatementBegin
CREATE TABLE "supplier_movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"supplier_id" uuid NOT NULL,
	"tipo" "tipo_movimiento_proveedor" NOT NULL,
	"monto" numeric(12, 2) NOT NULL,
	"detalle" text,
	"referencia" text,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
-- +goose StatementEnd
-- +goose StatementBegin
CREATE TABLE "suppliers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nombre" text NOT NULL,
	"razon_social" text,
	"cuit" text,
	"condicion_iva" "condicion_iva" DEFAULT 'responsable_inscripto' NOT NULL,
	"email" text,
	"telefono" text,
	"direccion" text,
	"rubro" text,
	"contacto" text,
	"dias_pago" integer DEFAULT 0 NOT NULL,
	"cbu" text,
	"alias_cbu" text,
	"estado" "estado_proveedor" DEFAULT 'activo' NOT NULL,
	"notas" text,
	"codigo_legacy" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE "supplier_movements" ADD CONSTRAINT "supplier_movements_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE cascade ON UPDATE no action;
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE "supplier_movements" ADD CONSTRAINT "supplier_movements_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
-- +goose StatementEnd
-- +goose StatementBegin
CREATE INDEX "supplier_movements_supplier_idx" ON "supplier_movements" USING btree ("supplier_id");
-- +goose StatementEnd
-- +goose StatementBegin
CREATE INDEX "supplier_movements_created_idx" ON "supplier_movements" USING btree ("created_at");
-- +goose StatementEnd
-- +goose StatementBegin
CREATE INDEX "suppliers_nombre_idx" ON "suppliers" USING btree ("nombre");
-- +goose StatementEnd
-- +goose StatementBegin
CREATE INDEX "suppliers_cuit_idx" ON "suppliers" USING btree ("cuit");
-- +goose StatementEnd
-- +goose StatementBegin
CREATE UNIQUE INDEX "suppliers_codigo_legacy_idx" ON "suppliers" USING btree ("codigo_legacy");
-- +goose StatementEnd
