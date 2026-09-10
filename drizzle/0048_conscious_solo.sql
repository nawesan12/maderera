ALTER TABLE "cutting_items" ADD COLUMN "aclaracion" text;--> statement-breakpoint
ALTER TABLE "cutting_orders" ADD COLUMN "canto_descripcion" text;--> statement-breakpoint
ALTER TABLE "cutting_rates" ADD COLUMN "precio_por_metro_canto" numeric(12, 2) DEFAULT '0' NOT NULL;