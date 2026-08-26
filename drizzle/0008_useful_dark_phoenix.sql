CREATE TYPE "public"."estado_comprobante" AS ENUM('borrador', 'emitida', 'autorizada', 'anulada', 'rechazada');--> statement-breakpoint
CREATE TYPE "public"."medio_cobro" AS ENUM('efectivo', 'transferencia', 'mercado_pago', 'tarjeta', 'cheque', 'cuenta_corriente');--> statement-breakpoint
CREATE TYPE "public"."regimen_iibb" AS ENUM('local', 'convenio_multilateral', 'exento', 'no_inscripto');--> statement-breakpoint
CREATE TYPE "public"."tipo_comprobante" AS ENUM('factura_a', 'factura_b', 'factura_c', 'nota_credito_a', 'nota_credito_b', 'nota_credito_c', 'nota_debito_a', 'nota_debito_b', 'nota_debito_c');--> statement-breakpoint
CREATE TABLE "arca_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid,
	"operacion" text NOT NULL,
	"ambiente" text DEFAULT 'homologacion' NOT NULL,
	"exito" boolean DEFAULT false NOT NULL,
	"solicitud" text,
	"respuesta" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "arca_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"servicio" text DEFAULT 'wsfe' NOT NULL,
	"ambiente" text DEFAULT 'homologacion' NOT NULL,
	"token" text NOT NULL,
	"sign" text NOT NULL,
	"expira_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "configuracion_fiscal" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"razon_social" text DEFAULT 'Maderera Juan B. Justo' NOT NULL,
	"nombre_fantasia" text,
	"cuit" text,
	"condicion_iva" "condicion_iva" DEFAULT 'responsable_inscripto' NOT NULL,
	"domicilio" text,
	"localidad" text DEFAULT 'Mar del Plata' NOT NULL,
	"codigo_postal" text,
	"telefono" text,
	"email" text,
	"ingresos_brutos" text,
	"regimen_iibb" "regimen_iibb" DEFAULT 'local' NOT NULL,
	"alicuota_percepcion_iibb" numeric(5, 2) DEFAULT '0' NOT NULL,
	"percibe_iibb" boolean DEFAULT false NOT NULL,
	"inicio_actividades" timestamp with time zone,
	"leyenda" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoice_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"descripcion" text NOT NULL,
	"unidad" text DEFAULT 'unidad' NOT NULL,
	"cantidad" numeric(12, 2) NOT NULL,
	"precio_unitario" numeric(12, 4) NOT NULL,
	"alicuota_iva" numeric(4, 2) DEFAULT '21' NOT NULL,
	"neto" numeric(12, 2) NOT NULL,
	"iva" numeric(12, 2) NOT NULL,
	"subtotal" numeric(12, 2) NOT NULL,
	"orden" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoice_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"medio" "medio_cobro" NOT NULL,
	"monto" numeric(12, 2) NOT NULL,
	"referencia" text,
	"fecha" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoice_tributos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"codigo" text DEFAULT '02' NOT NULL,
	"descripcion" text NOT NULL,
	"base_imponible" numeric(12, 2) NOT NULL,
	"alicuota" numeric(5, 2) NOT NULL,
	"importe" numeric(12, 2) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tipo" "tipo_comprobante" NOT NULL,
	"punto_venta_id" uuid,
	"punto_venta" integer NOT NULL,
	"numero" integer NOT NULL,
	"estado" "estado_comprobante" DEFAULT 'borrador' NOT NULL,
	"customer_id" uuid,
	"order_id" uuid,
	"receptor_nombre" text NOT NULL,
	"receptor_cuit" text,
	"receptor_condicion_iva" "condicion_iva" DEFAULT 'consumidor_final' NOT NULL,
	"receptor_domicilio" text,
	"neto" numeric(12, 2) DEFAULT '0' NOT NULL,
	"iva21" numeric(12, 2) DEFAULT '0' NOT NULL,
	"iva105" numeric(12, 2) DEFAULT '0' NOT NULL,
	"exento" numeric(12, 2) DEFAULT '0' NOT NULL,
	"tributos" numeric(12, 2) DEFAULT '0' NOT NULL,
	"total" numeric(12, 2) DEFAULT '0' NOT NULL,
	"cae" text,
	"cae_vencimiento" timestamp with time zone,
	"observaciones_arca" text,
	"comprobante_origen_id" uuid,
	"fecha_emision" timestamp with time zone DEFAULT now() NOT NULL,
	"fecha_vencimiento" timestamp with time zone,
	"observaciones" text,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "puntos_venta" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"numero" integer NOT NULL,
	"nombre" text NOT NULL,
	"branch_id" uuid,
	"modalidad" text DEFAULT 'webservice' NOT NULL,
	"activo" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "alicuota_iva" numeric(4, 2) DEFAULT '21' NOT NULL;--> statement-breakpoint
ALTER TABLE "arca_log" ADD CONSTRAINT "arca_log_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_payments" ADD CONSTRAINT "invoice_payments_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_tributos" ADD CONSTRAINT "invoice_tributos_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_punto_venta_id_puntos_venta_id_fk" FOREIGN KEY ("punto_venta_id") REFERENCES "public"."puntos_venta"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "puntos_venta" ADD CONSTRAINT "puntos_venta_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "arca_log_invoice_idx" ON "arca_log" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "invoice_items_invoice_idx" ON "invoice_items" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "invoice_payments_invoice_idx" ON "invoice_payments" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "invoice_tributos_invoice_idx" ON "invoice_tributos" USING btree ("invoice_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_numeracion_idx" ON "invoices" USING btree ("punto_venta","tipo","numero");--> statement-breakpoint
CREATE INDEX "invoices_customer_idx" ON "invoices" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "invoices_order_idx" ON "invoices" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "invoices_estado_idx" ON "invoices" USING btree ("estado");--> statement-breakpoint
CREATE INDEX "invoices_fecha_idx" ON "invoices" USING btree ("fecha_emision");--> statement-breakpoint
CREATE UNIQUE INDEX "puntos_venta_numero_idx" ON "puntos_venta" USING btree ("numero");