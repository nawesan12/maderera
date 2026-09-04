CREATE TYPE "public"."impuesto_retenido" AS ENUM('ganancias', 'iva', 'suss', 'iibb');--> statement-breakpoint
CREATE TABLE "regimenes_retencion" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"codigo" text NOT NULL,
	"nombre" text NOT NULL,
	"impuesto" "impuesto_retenido" NOT NULL,
	"alicuota" numeric(6, 3) NOT NULL,
	"alicuota_no_inscripto" numeric(6, 3) NOT NULL,
	"minimo_no_imponible" numeric(12, 2) DEFAULT '0' NOT NULL,
	"minimo_retencion" numeric(12, 2) DEFAULT '0' NOT NULL,
	"activo" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "retenciones_practicadas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	"regimen_id" uuid NOT NULL,
	"numero" text NOT NULL,
	"codigo_regimen" text NOT NULL,
	"impuesto" "impuesto_retenido" NOT NULL,
	"base" numeric(12, 2) NOT NULL,
	"alicuota" numeric(6, 3) NOT NULL,
	"importe" numeric(12, 2) NOT NULL,
	"fecha" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "retenciones_sufridas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"numero" text NOT NULL,
	"impuesto" "impuesto_retenido" NOT NULL,
	"codigo_regimen" text,
	"base" numeric(12, 2) NOT NULL,
	"alicuota" numeric(6, 3),
	"importe" numeric(12, 2) NOT NULL,
	"fecha" timestamp with time zone DEFAULT now() NOT NULL,
	"referencia" text,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "supplier_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"supplier_id" uuid NOT NULL,
	"fecha" timestamp with time zone DEFAULT now() NOT NULL,
	"total" numeric(12, 2) NOT NULL,
	"neto" numeric(12, 2) NOT NULL,
	"medio" text DEFAULT 'transferencia' NOT NULL,
	"referencia" text,
	"notas" text,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "retenciones_practicadas" ADD CONSTRAINT "retenciones_practicadas_payment_id_supplier_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."supplier_payments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retenciones_practicadas" ADD CONSTRAINT "retenciones_practicadas_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retenciones_practicadas" ADD CONSTRAINT "retenciones_practicadas_regimen_id_regimenes_retencion_id_fk" FOREIGN KEY ("regimen_id") REFERENCES "public"."regimenes_retencion"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retenciones_practicadas" ADD CONSTRAINT "retenciones_practicadas_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retenciones_sufridas" ADD CONSTRAINT "retenciones_sufridas_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retenciones_sufridas" ADD CONSTRAINT "retenciones_sufridas_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "regimenes_retencion_codigo_idx" ON "regimenes_retencion" USING btree ("codigo");--> statement-breakpoint
CREATE UNIQUE INDEX "retenciones_practicadas_numero_idx" ON "retenciones_practicadas" USING btree ("numero");--> statement-breakpoint
CREATE INDEX "retenciones_practicadas_pago_idx" ON "retenciones_practicadas" USING btree ("payment_id");--> statement-breakpoint
CREATE INDEX "retenciones_practicadas_fecha_idx" ON "retenciones_practicadas" USING btree ("fecha");--> statement-breakpoint
CREATE UNIQUE INDEX "retenciones_sufridas_numero_idx" ON "retenciones_sufridas" USING btree ("customer_id","numero");--> statement-breakpoint
CREATE INDEX "retenciones_sufridas_fecha_idx" ON "retenciones_sufridas" USING btree ("fecha");--> statement-breakpoint
CREATE INDEX "supplier_payments_supplier_idx" ON "supplier_payments" USING btree ("supplier_id");--> statement-breakpoint
CREATE INDEX "supplier_payments_fecha_idx" ON "supplier_payments" USING btree ("fecha");