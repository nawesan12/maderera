-- Migración 0043 de drizzle (0043_aberrant_jubilee), pasada a goose el 24/10/2026.
-- Historia congelada: no se edita (ver backend/db/convertir-drizzle.py).

-- +goose Up
-- +goose StatementBegin
CREATE TYPE "public"."estado_resena" AS ENUM('pendiente', 'publicada', 'rechazada');
-- +goose StatementEnd
-- +goose StatementBegin
CREATE TABLE "product_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"estrellas" integer NOT NULL,
	"texto" text DEFAULT '' NOT NULL,
	"nombre" text NOT NULL,
	"estado" "estado_resena" DEFAULT 'pendiente' NOT NULL,
	"motivo_rechazo" text,
	"resuelto_por" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE "product_reviews" ADD CONSTRAINT "product_reviews_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE "product_reviews" ADD CONSTRAINT "product_reviews_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE "product_reviews" ADD CONSTRAINT "product_reviews_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;
-- +goose StatementEnd
-- +goose StatementBegin
CREATE UNIQUE INDEX "product_reviews_pedido_producto_idx" ON "product_reviews" USING btree ("order_id","product_id");
-- +goose StatementEnd
-- +goose StatementBegin
CREATE INDEX "product_reviews_producto_idx" ON "product_reviews" USING btree ("product_id","estado");
-- +goose StatementEnd
-- +goose StatementBegin
CREATE INDEX "product_reviews_estado_idx" ON "product_reviews" USING btree ("estado","created_at");
-- +goose StatementEnd
