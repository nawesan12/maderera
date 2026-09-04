ALTER TABLE "invoice_items" ADD COLUMN "invoice_item_origen_id" uuid;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "acreditado" numeric(12, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "debitado" numeric(12, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
CREATE INDEX "invoice_items_origen_idx" ON "invoice_items" USING btree ("invoice_item_origen_id");