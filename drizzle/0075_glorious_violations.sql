ALTER TABLE "cutting_orders" ADD COLUMN "motor_plano" integer DEFAULT 2 NOT NULL;--> statement-breakpoint
-- Los que ya existen se armaron (y se cobraron) con el motor anterior.
UPDATE "cutting_orders" SET "motor_plano" = 1;
