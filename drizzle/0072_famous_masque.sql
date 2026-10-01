ALTER TABLE "calculator_settings" ALTER COLUMN "ancho_sierra_mm" SET DATA TYPE numeric(4, 1);--> statement-breakpoint
ALTER TABLE "calculator_settings" ALTER COLUMN "ancho_sierra_mm" SET DEFAULT 5;--> statement-breakpoint
ALTER TABLE "cutting_orders" ADD COLUMN "ancho_sierra_mm" numeric(4, 1) DEFAULT 5 NOT NULL;--> statement-breakpoint
-- Los trabajos que ya existen se quedan con el disco que había configurado al
-- migrar: así el plano y el precio de un corte viejo no cambian el día que
-- alguien toque la configuración.
UPDATE "cutting_orders" SET "ancho_sierra_mm" = coalesce((SELECT "ancho_sierra_mm" FROM "calculator_settings" LIMIT 1), 5);
