CREATE TABLE "supplier_price_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"supplier_id" uuid NOT NULL,
	"nombre" text DEFAULT 'Lista de precios' NOT NULL,
	"columna_codigo" text NOT NULL,
	"columna_precio" text NOT NULL,
	"columna_descripcion" text,
	"precio_es_neto" boolean DEFAULT false NOT NULL,
	"margen_porcentaje" numeric(5, 2) DEFAULT '0' NOT NULL,
	"activo" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "supplier_variant_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"supplier_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"codigo" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "supplier_price_profiles" ADD CONSTRAINT "supplier_price_profiles_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_variant_codes" ADD CONSTRAINT "supplier_variant_codes_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_variant_codes" ADD CONSTRAINT "supplier_variant_codes_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "supplier_price_profiles_proveedor_idx" ON "supplier_price_profiles" USING btree ("supplier_id");--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_variant_codes_idx" ON "supplier_variant_codes" USING btree ("supplier_id","codigo");--> statement-breakpoint
CREATE INDEX "supplier_variant_codes_variante_idx" ON "supplier_variant_codes" USING btree ("variant_id");