-- Migración 0025 de drizzle (0025_recepciones_y_costos), pasada a goose el 24/10/2026.
-- Historia congelada: no se edita (ver backend/db/convertir-drizzle.py).

-- +goose Up
-- +goose StatementBegin
CREATE TYPE "public"."estado_recepcion" AS ENUM('borrador', 'confirmada', 'anulada');
-- +goose StatementEnd
-- +goose StatementBegin
CREATE TABLE "goods_receipt_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"receipt_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"cantidad" numeric(14, 4) NOT NULL,
	"costo_unitario" numeric(14, 4) NOT NULL,
	"alicuota_iva" numeric(5, 2) DEFAULT '21' NOT NULL,
	"costo_con_gastos" numeric(14, 4),
	"cantidad_anterior" numeric(14, 4),
	"costo_anterior" numeric(14, 4),
	"costo_resultante" numeric(14, 4),
	"orden" integer DEFAULT 0 NOT NULL
);
-- +goose StatementEnd
-- +goose StatementBegin
CREATE TABLE "goods_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"supplier_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"numero_remito" text,
	"fecha" timestamp with time zone DEFAULT now() NOT NULL,
	"gastos" numeric(12, 2) DEFAULT '0' NOT NULL,
	"estado" "estado_recepcion" DEFAULT 'borrador' NOT NULL,
	"notas" text,
	"confirmada_at" timestamp with time zone,
	"confirmada_por" text,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
-- +goose StatementEnd
-- +goose StatementBegin
CREATE TABLE "cost_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"variant_id" uuid NOT NULL,
	"costo_anterior" numeric(14, 4) NOT NULL,
	"costo_nuevo" numeric(14, 4) NOT NULL,
	"cantidad_anterior" numeric(14, 4) NOT NULL,
	"cantidad_nueva" numeric(14, 4) NOT NULL,
	"documento_tipo" text,
	"documento_id" uuid,
	"motivo" text,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
-- +goose StatementEnd
-- +goose StatementBegin
CREATE TABLE "variant_costs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"variant_id" uuid NOT NULL,
	"cantidad_base" numeric(14, 4) DEFAULT '0' NOT NULL,
	"costo_promedio" numeric(14, 4) DEFAULT '0' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE "inventory_movements" ADD COLUMN "documento_tipo" text;
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE "inventory_movements" ADD COLUMN "documento_id" uuid;
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE "order_items" ADD COLUMN "costo_unitario" numeric(14, 4);
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE "order_items" ADD COLUMN "alicuota_iva" numeric(5, 2);
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE "goods_receipt_items" ADD CONSTRAINT "goods_receipt_items_receipt_id_goods_receipts_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."goods_receipts"("id") ON DELETE cascade ON UPDATE no action;
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE restrict ON UPDATE no action;
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_confirmada_por_user_id_fk" FOREIGN KEY ("confirmada_por") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE "cost_history" ADD CONSTRAINT "cost_history_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE cascade ON UPDATE no action;
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE "variant_costs" ADD CONSTRAINT "variant_costs_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE cascade ON UPDATE no action;
-- +goose StatementEnd
-- +goose StatementBegin
CREATE INDEX "goods_receipt_items_receipt_idx" ON "goods_receipt_items" USING btree ("receipt_id");
-- +goose StatementEnd
-- +goose StatementBegin
CREATE INDEX "goods_receipts_supplier_idx" ON "goods_receipts" USING btree ("supplier_id");
-- +goose StatementEnd
-- +goose StatementBegin
CREATE INDEX "goods_receipts_fecha_idx" ON "goods_receipts" USING btree ("fecha");
-- +goose StatementEnd
-- +goose StatementBegin
CREATE UNIQUE INDEX "goods_receipts_remito_idx" ON "goods_receipts" USING btree ("supplier_id","numero_remito");
-- +goose StatementEnd
-- +goose StatementBegin
CREATE INDEX "cost_history_variant_idx" ON "cost_history" USING btree ("variant_id");
-- +goose StatementEnd
-- +goose StatementBegin
CREATE INDEX "cost_history_created_idx" ON "cost_history" USING btree ("created_at");
-- +goose StatementEnd
-- +goose StatementBegin
CREATE UNIQUE INDEX "variant_costs_variant_idx" ON "variant_costs" USING btree ("variant_id");
-- +goose StatementEnd
-- +goose StatementBegin
CREATE INDEX "inventory_movements_documento_idx" ON "inventory_movements" USING btree ("documento_tipo","documento_id");
-- +goose StatementEnd
