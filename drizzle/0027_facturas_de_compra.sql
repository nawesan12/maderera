CREATE TYPE "public"."tipo_comprobante_compra" AS ENUM('factura_a', 'factura_b', 'factura_c', 'factura_m', 'nota_credito_a', 'nota_credito_b', 'nota_credito_c', 'nota_debito_a', 'nota_debito_b', 'nota_debito_c', 'ticket', 'otro');--> statement-breakpoint
CREATE TABLE "purchase_invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"supplier_id" uuid NOT NULL,
	"tipo" "tipo_comprobante_compra" NOT NULL,
	"punto_venta" integer DEFAULT 0 NOT NULL,
	"numero" integer DEFAULT 0 NOT NULL,
	"fecha_emision" timestamp with time zone DEFAULT now() NOT NULL,
	"fecha_vencimiento" timestamp with time zone,
	"cae" text,
	"neto" numeric(12, 2) DEFAULT '0' NOT NULL,
	"iva21" numeric(12, 2) DEFAULT '0' NOT NULL,
	"iva105" numeric(12, 2) DEFAULT '0' NOT NULL,
	"iva27" numeric(12, 2) DEFAULT '0' NOT NULL,
	"exento" numeric(12, 2) DEFAULT '0' NOT NULL,
	"percepciones" numeric(12, 2) DEFAULT '0' NOT NULL,
	"total" numeric(12, 2) DEFAULT '0' NOT NULL,
	"receipt_id" uuid,
	"observaciones" text,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "purchase_invoices" ADD CONSTRAINT "purchase_invoices_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_invoices" ADD CONSTRAINT "purchase_invoices_receipt_id_goods_receipts_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."goods_receipts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_invoices" ADD CONSTRAINT "purchase_invoices_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_invoices_numeracion_idx" ON "purchase_invoices" USING btree ("supplier_id","tipo","punto_venta","numero");--> statement-breakpoint
CREATE INDEX "purchase_invoices_fecha_idx" ON "purchase_invoices" USING btree ("fecha_emision");--> statement-breakpoint
CREATE INDEX "purchase_invoices_supplier_idx" ON "purchase_invoices" USING btree ("supplier_id");