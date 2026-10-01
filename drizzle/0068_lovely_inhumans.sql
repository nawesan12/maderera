CREATE TYPE "public"."forma_de_venta" AS ENUM('entera', 'entera_o_media', 'metro_cuadrado');--> statement-breakpoint
ALTER TABLE "inventory" ALTER COLUMN "qty" SET DATA TYPE numeric(12, 3);--> statement-breakpoint
ALTER TABLE "inventory" ALTER COLUMN "reservado" SET DATA TYPE numeric(12, 3);--> statement-breakpoint
ALTER TABLE "inventory" ALTER COLUMN "min_qty" SET DATA TYPE numeric(12, 3);--> statement-breakpoint
ALTER TABLE "inventory_movements" ALTER COLUMN "qty" SET DATA TYPE numeric(12, 3);--> statement-breakpoint
ALTER TABLE "stock_reservations" ALTER COLUMN "cantidad" SET DATA TYPE numeric(12, 3);--> statement-breakpoint
ALTER TABLE "cart_items" ADD COLUMN "presentacion" text;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "forma_de_venta" "forma_de_venta" DEFAULT 'entera' NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "precio_media_pct" numeric(5, 2) DEFAULT 50 NOT NULL;--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "presentacion" text;--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "stock_por_unidad" numeric(12, 6) DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "quote_items" ADD COLUMN "presentacion" text;--> statement-breakpoint
-- Hasta hoy toda placa se podía partir en el corte. Para no sacarle esa opción a
-- nadie, las placas existentes arrancan como «entera o media»; las que se venden
-- solo enteras (fenólicos, placas de color) se marcan después desde el panel.
-- Se toca además `updated_at` para que la copia local de cada mostrador baje el
-- cambio en el próximo delta y no recién en la sincronización completa del día.
UPDATE "products" SET "forma_de_venta" = 'entera_o_media', "updated_at" = now() WHERE "unit" = 'placa';
