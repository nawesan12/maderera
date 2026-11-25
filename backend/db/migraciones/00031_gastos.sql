-- Migración 0030 de drizzle (0030_gastos), pasada a goose el 24/10/2026.
-- Historia congelada: no se edita (ver backend/db/convertir-drizzle.py).

-- +goose Up
-- +goose StatementBegin
CREATE TYPE "public"."categoria_gasto" AS ENUM('flete', 'combustible', 'servicios', 'alquiler', 'sueldos', 'mantenimiento', 'impuestos', 'librería', 'publicidad', 'otros');
-- +goose StatementEnd
-- +goose StatementBegin
CREATE TYPE "public"."medio_gasto" AS ENUM('efectivo', 'transferencia', 'debito', 'credito', 'cheque');
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TYPE "public"."tipo_movimiento_caja" ADD VALUE 'gasto';
-- +goose StatementEnd
-- +goose StatementBegin
CREATE TABLE "expenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fecha" timestamp with time zone DEFAULT now() NOT NULL,
	"categoria" "categoria_gasto" DEFAULT 'otros' NOT NULL,
	"descripcion" text NOT NULL,
	"importe" numeric(12, 2) NOT NULL,
	"medio" "medio_gasto" DEFAULT 'efectivo' NOT NULL,
	"branch_id" uuid,
	"supplier_id" uuid,
	"purchase_invoice_id" uuid,
	"notas" text,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE set null ON UPDATE no action;
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_purchase_invoice_id_purchase_invoices_id_fk" FOREIGN KEY ("purchase_invoice_id") REFERENCES "public"."purchase_invoices"("id") ON DELETE set null ON UPDATE no action;
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
-- +goose StatementEnd
-- +goose StatementBegin
CREATE INDEX "expenses_fecha_idx" ON "expenses" USING btree ("fecha");
-- +goose StatementEnd
-- +goose StatementBegin
CREATE INDEX "expenses_categoria_idx" ON "expenses" USING btree ("categoria");
-- +goose StatementEnd
-- +goose StatementBegin
CREATE INDEX "expenses_supplier_idx" ON "expenses" USING btree ("supplier_id");
-- +goose StatementEnd
