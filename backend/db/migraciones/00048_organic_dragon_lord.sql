-- Migración 0047 de drizzle (0047_organic_dragon_lord), pasada a goose el 24/10/2026.
-- Historia congelada: no se edita (ver backend/db/convertir-drizzle.py).

-- +goose Up
-- +goose StatementBegin
CREATE TYPE "public"."tipo_vendedor" AS ENUM('salon', 'calle');
-- +goose StatementEnd
-- +goose StatementBegin
CREATE TABLE "sellers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nombre" text NOT NULL,
	"tipo" "tipo_vendedor" DEFAULT 'salon' NOT NULL,
	"activo" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
-- +goose StatementEnd
-- +goose StatementBegin
CREATE TABLE "order_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"medio" "medio_pago" NOT NULL,
	"importe" numeric(12, 2) NOT NULL,
	"nro_lote" text,
	"nro_cupon" text,
	"tarjeta" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE "customers" ADD COLUMN "seller_id" uuid;
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE "orders" ADD COLUMN "seller_id" uuid;
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE "quotes" ADD COLUMN "seller_id" uuid;
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE "order_payments" ADD CONSTRAINT "order_payments_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;
-- +goose StatementEnd
-- +goose StatementBegin
CREATE UNIQUE INDEX "sellers_nombre_idx" ON "sellers" USING btree ("nombre");
-- +goose StatementEnd
-- +goose StatementBegin
CREATE INDEX "order_payments_order_idx" ON "order_payments" USING btree ("order_id");
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE "customers" ADD CONSTRAINT "customers_seller_id_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."sellers"("id") ON DELETE set null ON UPDATE no action;
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE "orders" ADD CONSTRAINT "orders_seller_id_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."sellers"("id") ON DELETE set null ON UPDATE no action;
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_seller_id_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."sellers"("id") ON DELETE set null ON UPDATE no action;
-- +goose StatementEnd
