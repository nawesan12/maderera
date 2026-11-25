-- Migración 0028 de drizzle (0028_ordenes_de_compra), pasada a goose el 24/10/2026.
-- Historia congelada: no se edita (ver backend/db/convertir-drizzle.py).

-- +goose Up
-- +goose StatementBegin
CREATE TYPE "public"."estado_orden_compra" AS ENUM('borrador', 'enviada', 'parcial', 'completa', 'anulada');
-- +goose StatementEnd
-- +goose StatementBegin
CREATE TABLE "purchase_order_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"purchase_order_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"descripcion" text NOT NULL,
	"cantidad" numeric(14, 4) NOT NULL,
	"cantidad_recibida" numeric(14, 4) DEFAULT '0' NOT NULL,
	"costo_unitario" numeric(14, 4) NOT NULL,
	"alicuota_iva" numeric(5, 2) DEFAULT '21' NOT NULL,
	"orden" integer DEFAULT 0 NOT NULL
);
-- +goose StatementEnd
-- +goose StatementBegin
CREATE TABLE "purchase_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"numero" text NOT NULL,
	"supplier_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"estado" "estado_orden_compra" DEFAULT 'borrador' NOT NULL,
	"fecha_prometida" timestamp with time zone,
	"notas" text,
	"enviada_at" timestamp with time zone,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE "goods_receipt_items" ADD COLUMN "purchase_order_item_id" uuid;
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE "goods_receipts" ADD COLUMN "purchase_order_id" uuid;
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_purchase_order_id_purchase_orders_id_fk" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."purchase_orders"("id") ON DELETE cascade ON UPDATE no action;
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE restrict ON UPDATE no action;
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
-- +goose StatementEnd
-- +goose StatementBegin
CREATE INDEX "purchase_order_items_order_idx" ON "purchase_order_items" USING btree ("purchase_order_id");
-- +goose StatementEnd
-- +goose StatementBegin
CREATE UNIQUE INDEX "purchase_orders_numero_idx" ON "purchase_orders" USING btree ("numero");
-- +goose StatementEnd
-- +goose StatementBegin
CREATE INDEX "purchase_orders_supplier_idx" ON "purchase_orders" USING btree ("supplier_id");
-- +goose StatementEnd
-- +goose StatementBegin
CREATE INDEX "purchase_orders_estado_idx" ON "purchase_orders" USING btree ("estado");
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE "goods_receipt_items" ADD CONSTRAINT "goods_receipt_items_purchase_order_item_id_purchase_order_items_id_fk" FOREIGN KEY ("purchase_order_item_id") REFERENCES "public"."purchase_order_items"("id") ON DELETE set null ON UPDATE no action;
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_purchase_order_id_purchase_orders_id_fk" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."purchase_orders"("id") ON DELETE set null ON UPDATE no action;
-- +goose StatementEnd
