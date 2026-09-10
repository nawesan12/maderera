CREATE TYPE "public"."modalidad_de_pago" AS ENUM('transferencia', 'cheque', 'echeq', 'efectivo', 'otro');--> statement-breakpoint
CREATE TYPE "public"."estado_cheque" AS ENUM('cartera', 'entregado', 'depositado', 'acreditado', 'rechazado', 'anulado');--> statement-breakpoint
CREATE TYPE "public"."sentido_cheque" AS ENUM('recibido', 'entregado');--> statement-breakpoint
CREATE TYPE "public"."tipo_cheque" AS ENUM('fisico', 'echeq');--> statement-breakpoint
CREATE TABLE "supplier_terms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"supplier_id" uuid NOT NULL,
	"modalidad" "modalidad_de_pago" NOT NULL,
	"plazo_dias" integer DEFAULT 0 NOT NULL,
	"bonificacion_pct" numeric(6, 2) DEFAULT '0' NOT NULL,
	"detalle" text,
	"activo" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "supplier_payment_allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_id" uuid NOT NULL,
	"purchase_invoice_id" uuid NOT NULL,
	"importe" numeric(12, 2) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "supplier_payment_parts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_id" uuid NOT NULL,
	"medio" text NOT NULL,
	"importe" numeric(12, 2) NOT NULL,
	"referencia" text,
	"cheque_id" uuid
);
--> statement-breakpoint
CREATE TABLE "cheques" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sentido" "sentido_cheque" NOT NULL,
	"tipo" "tipo_cheque" DEFAULT 'fisico' NOT NULL,
	"numero" text NOT NULL,
	"banco" text,
	"librador" text,
	"emision" timestamp with time zone,
	"fecha_pago" timestamp with time zone NOT NULL,
	"importe" numeric(12, 2) NOT NULL,
	"estado" "estado_cheque" DEFAULT 'cartera' NOT NULL,
	"customer_id" uuid,
	"order_payment_id" uuid,
	"notas" text,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN "convenios" text;--> statement-breakpoint
ALTER TABLE "supplier_terms" ADD CONSTRAINT "supplier_terms_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_payment_allocations" ADD CONSTRAINT "supplier_payment_allocations_payment_id_supplier_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."supplier_payments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_payment_allocations" ADD CONSTRAINT "supplier_payment_allocations_purchase_invoice_id_purchase_invoices_id_fk" FOREIGN KEY ("purchase_invoice_id") REFERENCES "public"."purchase_invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_payment_parts" ADD CONSTRAINT "supplier_payment_parts_payment_id_supplier_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."supplier_payments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_payment_parts" ADD CONSTRAINT "supplier_payment_parts_cheque_id_cheques_id_fk" FOREIGN KEY ("cheque_id") REFERENCES "public"."cheques"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cheques" ADD CONSTRAINT "cheques_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cheques" ADD CONSTRAINT "cheques_order_payment_id_order_payments_id_fk" FOREIGN KEY ("order_payment_id") REFERENCES "public"."order_payments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cheques" ADD CONSTRAINT "cheques_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "supplier_terms_supplier_idx" ON "supplier_terms" USING btree ("supplier_id");--> statement-breakpoint
CREATE INDEX "supplier_payment_allocations_payment_idx" ON "supplier_payment_allocations" USING btree ("payment_id");--> statement-breakpoint
CREATE INDEX "supplier_payment_allocations_invoice_idx" ON "supplier_payment_allocations" USING btree ("purchase_invoice_id");--> statement-breakpoint
CREATE INDEX "supplier_payment_parts_payment_idx" ON "supplier_payment_parts" USING btree ("payment_id");--> statement-breakpoint
CREATE INDEX "cheques_estado_idx" ON "cheques" USING btree ("estado","fecha_pago");--> statement-breakpoint
CREATE INDEX "cheques_fecha_pago_idx" ON "cheques" USING btree ("fecha_pago");--> statement-breakpoint
CREATE INDEX "cheques_customer_idx" ON "cheques" USING btree ("customer_id");