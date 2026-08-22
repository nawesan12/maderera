ALTER TABLE "price_list_items" ADD COLUMN "precio_anterior" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "price_list_items" ADD COLUMN "oferta_hasta" timestamp with time zone;