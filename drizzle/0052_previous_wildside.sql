ALTER TABLE "products" ADD COLUMN "imputacion" text;--> statement-breakpoint
CREATE INDEX "products_imputacion_idx" ON "products" USING btree ("imputacion");