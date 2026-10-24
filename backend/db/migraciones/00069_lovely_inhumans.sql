-- Migración 0068 de drizzle (0068_lovely_inhumans), pasada a goose el 24/10/2026.
-- Historia congelada: no se edita (ver backend/db/convertir-drizzle.py).

-- +goose Up
-- +goose StatementBegin
CREATE TYPE "public"."forma_de_venta" AS ENUM('entera', 'entera_o_media', 'metro_cuadrado');
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE "inventory" ALTER COLUMN "qty" SET DATA TYPE numeric(12, 3);
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE "inventory" ALTER COLUMN "reservado" SET DATA TYPE numeric(12, 3);
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE "inventory" ALTER COLUMN "min_qty" SET DATA TYPE numeric(12, 3);
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE "inventory_movements" ALTER COLUMN "qty" SET DATA TYPE numeric(12, 3);
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE "stock_reservations" ALTER COLUMN "cantidad" SET DATA TYPE numeric(12, 3);
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE "cart_items" ADD COLUMN "presentacion" text;
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE "products" ADD COLUMN "forma_de_venta" "forma_de_venta" DEFAULT 'entera' NOT NULL;
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE "products" ADD COLUMN "precio_media_pct" numeric(5, 2) DEFAULT 50 NOT NULL;
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE "order_items" ADD COLUMN "presentacion" text;
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE "order_items" ADD COLUMN "stock_por_unidad" numeric(12, 6) DEFAULT 1 NOT NULL;
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE "quote_items" ADD COLUMN "presentacion" text;
-- +goose StatementEnd
-- +goose StatementBegin
-- Hasta hoy toda placa se podía partir en el corte. Para no sacarle esa opción a
-- nadie, las placas existentes arrancan como «entera o media»; las que se venden
-- solo enteras (fenólicos, placas de color) se marcan después desde el panel.
-- Se toca además `updated_at` para que la copia local de cada mostrador baje el
-- cambio en el próximo delta y no recién en la sincronización completa del día.
UPDATE "products" SET "forma_de_venta" = 'entera_o_media', "updated_at" = now() WHERE "unit" = 'placa';
-- +goose StatementEnd
