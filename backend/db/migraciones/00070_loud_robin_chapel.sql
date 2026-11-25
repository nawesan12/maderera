-- Migración 0069 de drizzle (0069_loud_robin_chapel), pasada a goose el 24/10/2026.
-- Historia congelada: no se edita (ver backend/db/convertir-drizzle.py).

-- +goose Up
-- +goose StatementBegin
CREATE TYPE "public"."estado_recibo" AS ENUM('emitido', 'anulado');
-- +goose StatementEnd
-- +goose StatementBegin
CREATE TYPE "public"."medio_de_cobro" AS ENUM('efectivo', 'transferencia', 'deposito', 'cheque', 'echeq', 'tarjeta_debito', 'tarjeta_credito', 'mercado_pago', 'retencion');
-- +goose StatementEnd
-- +goose StatementBegin
CREATE TYPE "public"."origen_recibo" AS ENUM('panel', 'mostrador', 'portal', 'mercado_pago', 'factura');
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TYPE "public"."estado_cheque" ADD VALUE IF NOT EXISTS 'informado' BEFORE 'cartera';
-- +goose StatementEnd
-- +goose StatementBegin
CREATE TABLE "receipt_parts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"receipt_id" uuid NOT NULL,
	"medio" "medio_de_cobro" NOT NULL,
	"importe" numeric(12, 2) NOT NULL,
	"cheque_id" uuid,
	"payment_id" uuid,
	"referencia" text,
	"orden" integer DEFAULT 0 NOT NULL
);
-- +goose StatementEnd
-- +goose StatementBegin
CREATE TABLE "receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"numero" text NOT NULL,
	"customer_id" uuid,
	"recibido_de" text NOT NULL,
	"branch_id" uuid,
	"total" numeric(12, 2) NOT NULL,
	"estado" "estado_recibo" DEFAULT 'emitido' NOT NULL,
	"origen" "origen_recibo" NOT NULL,
	"concepto" text,
	"account_movement_id" uuid,
	"anulacion_movement_id" uuid,
	"motivo_anulacion" text,
	"anulado_at" timestamp with time zone,
	"anulado_por_user_id" text,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE "account_movements" ADD COLUMN "receipt_id" uuid;
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE "account_movements" ADD COLUMN "cheque_id" uuid;
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE "cheques" ADD COLUMN "receipt_id" uuid;
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE "cheques" ADD COLUMN "motivo_rechazo" text;
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE "receipt_parts" ADD CONSTRAINT "receipt_parts_receipt_id_receipts_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."receipts"("id") ON DELETE cascade ON UPDATE no action;
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE "receipt_parts" ADD CONSTRAINT "receipt_parts_cheque_id_cheques_id_fk" FOREIGN KEY ("cheque_id") REFERENCES "public"."cheques"("id") ON DELETE restrict ON UPDATE no action;
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE "receipt_parts" ADD CONSTRAINT "receipt_parts_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE set null ON UPDATE no action;
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE set null ON UPDATE no action;
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_anulado_por_user_id_user_id_fk" FOREIGN KEY ("anulado_por_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
-- +goose StatementEnd
-- +goose StatementBegin
CREATE INDEX "receipt_parts_receipt_idx" ON "receipt_parts" USING btree ("receipt_id");
-- +goose StatementEnd
-- +goose StatementBegin
CREATE INDEX "receipt_parts_cheque_idx" ON "receipt_parts" USING btree ("cheque_id");
-- +goose StatementEnd
-- +goose StatementBegin
CREATE UNIQUE INDEX "receipts_numero_idx" ON "receipts" USING btree ("numero");
-- +goose StatementEnd
-- +goose StatementBegin
CREATE INDEX "receipts_customer_idx" ON "receipts" USING btree ("customer_id","created_at");
-- +goose StatementEnd
-- +goose StatementBegin
CREATE INDEX "receipts_created_idx" ON "receipts" USING btree ("created_at");
-- +goose StatementEnd
-- +goose StatementBegin
CREATE INDEX "account_movements_receipt_idx" ON "account_movements" USING btree ("receipt_id");
-- +goose StatementEnd
-- +goose StatementBegin
CREATE UNIQUE INDEX "cheques_recibido_unico_idx" ON "cheques" USING btree (lower(coalesce("banco", '')),"numero") WHERE "cheques"."sentido" = 'recibido' and "cheques"."estado" not in ('anulado', 'rechazado');
-- +goose StatementEnd
