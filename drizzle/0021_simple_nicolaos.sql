ALTER TYPE "public"."proveedor_pago" ADD VALUE 'mostrador' BEFORE 'demo';--> statement-breakpoint
ALTER TYPE "public"."medio_pago" ADD VALUE 'debito' BEFORE 'cuenta_corriente';--> statement-breakpoint
ALTER TYPE "public"."medio_pago" ADD VALUE 'credito' BEFORE 'cuenta_corriente';--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "clave_mostrador" text;--> statement-breakpoint
CREATE UNIQUE INDEX "orders_clave_mostrador_idx" ON "orders" USING btree ("clave_mostrador");