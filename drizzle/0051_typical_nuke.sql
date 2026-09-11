CREATE TYPE "public"."circuito" AS ENUM('blanco', 'negro');--> statement-breakpoint
ALTER TABLE "supplier_payments" ADD COLUMN "circuito" "circuito" DEFAULT 'blanco' NOT NULL;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "circuito" "circuito" DEFAULT 'blanco' NOT NULL;--> statement-breakpoint
ALTER TABLE "cheques" ADD COLUMN "circuito" "circuito" DEFAULT 'blanco' NOT NULL;--> statement-breakpoint
CREATE INDEX "supplier_payments_circuito_idx" ON "supplier_payments" USING btree ("circuito","fecha");--> statement-breakpoint
CREATE INDEX "expenses_circuito_idx" ON "expenses" USING btree ("circuito","fecha");--> statement-breakpoint
CREATE INDEX "cheques_circuito_idx" ON "cheques" USING btree ("circuito","fecha_pago");