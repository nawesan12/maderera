CREATE TYPE "public"."estado_cliente" AS ENUM('activo', 'moroso', 'inactivo');--> statement-breakpoint
CREATE TYPE "public"."tipo_cliente" AS ENUM('particular', 'profesional');--> statement-breakpoint
CREATE TYPE "public"."tipo_movimiento_cuenta" AS ENUM('compra', 'pago', 'nota_credito', 'nota_debito', 'ajuste');--> statement-breakpoint
CREATE TYPE "public"."estado_corte" AS ENUM('en-cola', 'en-proceso', 'terminado', 'retirado');--> statement-breakpoint
CREATE TYPE "public"."estado_pago" AS ENUM('pendiente', 'pagado', 'parcial', 'rechazado', 'reintegrado');--> statement-breakpoint
CREATE TYPE "public"."estado_pedido" AS ENUM('pendiente', 'preparando', 'listo', 'en-camino', 'entregado', 'cancelado');--> statement-breakpoint
CREATE TYPE "public"."estado_presupuesto" AS ENUM('pendiente', 'revision', 'enviado', 'aceptado', 'rechazado', 'vencido');--> statement-breakpoint
CREATE TYPE "public"."medio_pago" AS ENUM('mercado_pago', 'transferencia', 'efectivo', 'cuenta_corriente');--> statement-breakpoint
CREATE TYPE "public"."origen_pedido" AS ENUM('tienda', 'mostrador', 'telefono', 'presupuesto');--> statement-breakpoint
CREATE TYPE "public"."origen_presupuesto" AS ENUM('sitio', 'calculadora', 'mostrador', 'telefono');--> statement-breakpoint
CREATE TYPE "public"."tipo_entrega" AS ENUM('retiro', 'envio');--> statement-breakpoint
CREATE TABLE "cart_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cart_id" uuid NOT NULL,
	"variant_id" uuid,
	"descripcion" text NOT NULL,
	"unidad" text DEFAULT 'unidad' NOT NULL,
	"cantidad" numeric(12, 2) DEFAULT '1' NOT NULL,
	"precio_unitario" numeric(12, 2),
	"origen" text DEFAULT 'catalogo' NOT NULL,
	"notas" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "carts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token" text NOT NULL,
	"user_id" text,
	"activo" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shipping_zones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nombre" text NOT NULL,
	"cobertura" text DEFAULT '' NOT NULL,
	"costo" numeric(12, 2) DEFAULT '0' NOT NULL,
	"envio_gratis_desde" numeric(12, 2) DEFAULT '0' NOT NULL,
	"demora_estimada" text,
	"activa" boolean DEFAULT true NOT NULL,
	"orden" numeric(4, 0) DEFAULT '0' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "account_movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"tipo" "tipo_movimiento_cuenta" NOT NULL,
	"monto" numeric(12, 2) NOT NULL,
	"detalle" text,
	"referencia" text,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text,
	"nombre" text NOT NULL,
	"razon_social" text,
	"cuit" text,
	"condicion_iva" "condicion_iva" DEFAULT 'consumidor_final' NOT NULL,
	"email" text,
	"telefono" text,
	"direccion" text,
	"rubro" text,
	"tipo" "tipo_cliente" DEFAULT 'particular' NOT NULL,
	"estado" "estado_cliente" DEFAULT 'activo' NOT NULL,
	"price_list_id" uuid,
	"limite_credito" numeric(12, 2) DEFAULT '0' NOT NULL,
	"asesor" text,
	"notas" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cutting_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cutting_order_id" uuid NOT NULL,
	"largo_mm" integer NOT NULL,
	"ancho_mm" integer NOT NULL,
	"cantidad" integer DEFAULT 1 NOT NULL,
	"respeta_veta" integer DEFAULT 0 NOT NULL,
	"canto_largo" integer DEFAULT 0 NOT NULL,
	"canto_ancho" integer DEFAULT 0 NOT NULL,
	"etiqueta" text,
	"orden" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cutting_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"numero" text NOT NULL,
	"customer_id" uuid,
	"order_id" uuid,
	"contacto_nombre" text NOT NULL,
	"branch_id" uuid,
	"variant_id" uuid,
	"material_descripcion" text NOT NULL,
	"placas" integer DEFAULT 1 NOT NULL,
	"estado" "estado_corte" DEFAULT 'en-cola' NOT NULL,
	"urgente" integer DEFAULT 0 NOT NULL,
	"notas" text,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"variant_id" uuid,
	"descripcion" text NOT NULL,
	"unidad" text DEFAULT 'unidad' NOT NULL,
	"cantidad" numeric(12, 2) NOT NULL,
	"precio_unitario" numeric(12, 2) NOT NULL,
	"subtotal" numeric(12, 2) NOT NULL,
	"orden" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_status_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"estado" "estado_pedido" NOT NULL,
	"nota" text,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"numero" text NOT NULL,
	"customer_id" uuid,
	"quote_id" uuid,
	"contacto_nombre" text NOT NULL,
	"contacto_email" text,
	"contacto_telefono" text,
	"branch_id" uuid,
	"estado" "estado_pedido" DEFAULT 'pendiente' NOT NULL,
	"origen" "origen_pedido" DEFAULT 'mostrador' NOT NULL,
	"tipo_entrega" "tipo_entrega" DEFAULT 'retiro' NOT NULL,
	"direccion_entrega" text,
	"zona_envio" text,
	"costo_envio" numeric(12, 2) DEFAULT '0' NOT NULL,
	"subtotal" numeric(12, 2) DEFAULT '0' NOT NULL,
	"total" numeric(12, 2) DEFAULT '0' NOT NULL,
	"medio_pago" "medio_pago",
	"estado_pago" "estado_pago" DEFAULT 'pendiente' NOT NULL,
	"notas" text,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quote_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"quote_id" uuid NOT NULL,
	"variant_id" uuid,
	"descripcion" text NOT NULL,
	"unidad" text DEFAULT 'unidad' NOT NULL,
	"cantidad" numeric(12, 2) NOT NULL,
	"precio_unitario" numeric(12, 2) NOT NULL,
	"subtotal" numeric(12, 2) NOT NULL,
	"notas" text,
	"orden" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quotes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"numero" text NOT NULL,
	"customer_id" uuid,
	"contacto_nombre" text NOT NULL,
	"contacto_email" text,
	"contacto_telefono" text,
	"branch_id" uuid,
	"estado" "estado_presupuesto" DEFAULT 'pendiente' NOT NULL,
	"origen" "origen_presupuesto" DEFAULT 'mostrador' NOT NULL,
	"subtotal" numeric(12, 2) DEFAULT '0' NOT NULL,
	"total" numeric(12, 2) DEFAULT '0' NOT NULL,
	"notas" text,
	"asesor" text,
	"valido_hasta" timestamp with time zone,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_cart_id_carts_id_fk" FOREIGN KEY ("cart_id") REFERENCES "public"."carts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carts" ADD CONSTRAINT "carts_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_movements" ADD CONSTRAINT "account_movements_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_price_list_id_price_lists_id_fk" FOREIGN KEY ("price_list_id") REFERENCES "public"."price_lists"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cutting_items" ADD CONSTRAINT "cutting_items_cutting_order_id_cutting_orders_id_fk" FOREIGN KEY ("cutting_order_id") REFERENCES "public"."cutting_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cutting_orders" ADD CONSTRAINT "cutting_orders_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cutting_orders" ADD CONSTRAINT "cutting_orders_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cutting_orders" ADD CONSTRAINT "cutting_orders_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cutting_orders" ADD CONSTRAINT "cutting_orders_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_status_history" ADD CONSTRAINT "order_status_history_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_items" ADD CONSTRAINT "quote_items_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_items" ADD CONSTRAINT "quote_items_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cart_items_cart_idx" ON "cart_items" USING btree ("cart_id");--> statement-breakpoint
CREATE UNIQUE INDEX "carts_token_idx" ON "carts" USING btree ("token");--> statement-breakpoint
CREATE INDEX "carts_user_idx" ON "carts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "shipping_zones_activa_idx" ON "shipping_zones" USING btree ("activa");--> statement-breakpoint
CREATE INDEX "account_movements_customer_idx" ON "account_movements" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "account_movements_created_idx" ON "account_movements" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "customers_nombre_idx" ON "customers" USING btree ("nombre");--> statement-breakpoint
CREATE INDEX "customers_cuit_idx" ON "customers" USING btree ("cuit");--> statement-breakpoint
CREATE UNIQUE INDEX "customers_user_idx" ON "customers" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "cutting_items_order_idx" ON "cutting_items" USING btree ("cutting_order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cutting_orders_numero_idx" ON "cutting_orders" USING btree ("numero");--> statement-breakpoint
CREATE INDEX "cutting_orders_estado_idx" ON "cutting_orders" USING btree ("estado");--> statement-breakpoint
CREATE INDEX "order_items_order_idx" ON "order_items" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "order_status_history_order_idx" ON "order_status_history" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_numero_idx" ON "orders" USING btree ("numero");--> statement-breakpoint
CREATE INDEX "orders_customer_idx" ON "orders" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "orders_estado_idx" ON "orders" USING btree ("estado");--> statement-breakpoint
CREATE INDEX "orders_created_idx" ON "orders" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "quote_items_quote_idx" ON "quote_items" USING btree ("quote_id");--> statement-breakpoint
CREATE UNIQUE INDEX "quotes_numero_idx" ON "quotes" USING btree ("numero");--> statement-breakpoint
CREATE INDEX "quotes_customer_idx" ON "quotes" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "quotes_estado_idx" ON "quotes" USING btree ("estado");--> statement-breakpoint
CREATE INDEX "quotes_created_idx" ON "quotes" USING btree ("created_at");