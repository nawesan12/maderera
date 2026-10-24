-- Migración 0033 de drizzle (0033_massive_mandarin), pasada a goose el 24/10/2026.
-- Historia congelada: no se edita (ver backend/db/convertir-drizzle.py).

-- +goose Up
-- +goose StatementBegin
ALTER TYPE "public"."entidad_migracion" ADD VALUE 'proveedores';
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TYPE "public"."entidad_migracion" ADD VALUE 'ventas_historicas';
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TYPE "public"."entidad_migracion" ADD VALUE 'comprobantes_historicos';
-- +goose StatementEnd
-- +goose StatementBegin
CREATE TABLE "historical_invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"punto_venta" integer NOT NULL,
	"tipo" text NOT NULL,
	"numero" integer NOT NULL,
	"codigo_cliente_legacy" text,
	"customer_id" uuid,
	"cliente_nombre" text DEFAULT '' NOT NULL,
	"cliente_cuit" text,
	"fecha" timestamp with time zone NOT NULL,
	"neto" numeric(14, 2) DEFAULT '0' NOT NULL,
	"iva" numeric(14, 2) DEFAULT '0' NOT NULL,
	"total" numeric(14, 2) DEFAULT '0' NOT NULL,
	"cae" text,
	"cae_vence" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
-- +goose StatementEnd
-- +goose StatementBegin
CREATE TABLE "historical_sales" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"comprobante_legacy" text NOT NULL,
	"codigo_cliente_legacy" text,
	"customer_id" uuid,
	"cliente_nombre" text DEFAULT '' NOT NULL,
	"fecha" timestamp with time zone NOT NULL,
	"total" numeric(14, 2) DEFAULT '0' NOT NULL,
	"detalle" text DEFAULT '' NOT NULL,
	"sucursal" text,
	"vendedor" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
-- +goose StatementEnd
-- +goose StatementBegin
CREATE TABLE "cutting_rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"material" text NOT NULL,
	"price_list_id" uuid,
	"precio_por_pasada" numeric(12, 2) NOT NULL,
	"activo" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
-- +goose StatementEnd
-- +goose StatementBegin
CREATE TABLE "payment_discounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"medio" "medio_pago" NOT NULL,
	"desde_monto" numeric(12, 2) DEFAULT '0' NOT NULL,
	"porcentaje" numeric(5, 2) NOT NULL,
	"etiqueta" text DEFAULT '' NOT NULL,
	"activo" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE "shipping_zones" ADD COLUMN "a_cotizar" boolean DEFAULT false NOT NULL;
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE "products" ADD COLUMN "a_pedido" boolean DEFAULT false NOT NULL;
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE "puntos_venta" ADD COLUMN "numero_inicial" integer DEFAULT 0 NOT NULL;
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE "quotes" ADD COLUMN "necesita_para" timestamp with time zone;
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE "historical_invoices" ADD CONSTRAINT "historical_invoices_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE "historical_sales" ADD CONSTRAINT "historical_sales_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE "cutting_rates" ADD CONSTRAINT "cutting_rates_price_list_id_price_lists_id_fk" FOREIGN KEY ("price_list_id") REFERENCES "public"."price_lists"("id") ON DELETE cascade ON UPDATE no action;
-- +goose StatementEnd
-- +goose StatementBegin
CREATE UNIQUE INDEX "historical_invoices_numeracion_idx" ON "historical_invoices" USING btree ("punto_venta","tipo","numero");
-- +goose StatementEnd
-- +goose StatementBegin
CREATE INDEX "historical_invoices_customer_idx" ON "historical_invoices" USING btree ("customer_id");
-- +goose StatementEnd
-- +goose StatementBegin
CREATE INDEX "historical_invoices_fecha_idx" ON "historical_invoices" USING btree ("fecha");
-- +goose StatementEnd
-- +goose StatementBegin
CREATE UNIQUE INDEX "historical_sales_legacy_idx" ON "historical_sales" USING btree ("comprobante_legacy");
-- +goose StatementEnd
-- +goose StatementBegin
CREATE INDEX "historical_sales_customer_idx" ON "historical_sales" USING btree ("customer_id");
-- +goose StatementEnd
-- +goose StatementBegin
CREATE INDEX "historical_sales_fecha_idx" ON "historical_sales" USING btree ("fecha");
-- +goose StatementEnd
-- +goose StatementBegin
CREATE UNIQUE INDEX "cutting_rates_material_lista_idx" ON "cutting_rates" USING btree ("material","price_list_id");
-- +goose StatementEnd
-- +goose StatementBegin
CREATE INDEX "cutting_rates_activo_idx" ON "cutting_rates" USING btree ("activo");
-- +goose StatementEnd
-- +goose StatementBegin
CREATE UNIQUE INDEX "payment_discounts_medio_desde_idx" ON "payment_discounts" USING btree ("medio","desde_monto");
-- +goose StatementEnd
-- +goose StatementBegin
CREATE INDEX "payment_discounts_activo_idx" ON "payment_discounts" USING btree ("activo");
-- +goose StatementEnd
-- +goose StatementBegin
CREATE INDEX "quotes_necesita_idx" ON "quotes" USING btree ("necesita_para");
-- +goose StatementEnd
