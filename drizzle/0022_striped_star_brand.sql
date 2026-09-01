ALTER TABLE "orders" ADD COLUMN "descuento" numeric(12, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "descuento_motivo" text;