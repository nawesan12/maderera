-- Migración 0000 de drizzle (0000_boring_kulan_gath), pasada a goose el 24/10/2026.
-- Historia congelada: no se edita (ver backend/db/convertir-drizzle.py).

-- +goose Up
-- +goose StatementBegin
CREATE TYPE "public"."unit_of_sale" AS ENUM('unidad', 'metro_lineal', 'metro_cuadrado', 'placa', 'rollo', 'par', 'juego', 'kg', 'litro');
-- +goose StatementEnd
-- +goose StatementBegin
CREATE TYPE "public"."movement_type" AS ENUM('ingreso', 'egreso', 'ajuste', 'transferencia_salida', 'transferencia_entrada', 'venta', 'devolucion');
-- +goose StatementEnd
-- +goose StatementBegin
CREATE TYPE "public"."condicion_iva" AS ENUM('responsable_inscripto', 'monotributista', 'exento', 'consumidor_final', 'no_categorizado');
-- +goose StatementEnd
-- +goose StatementBegin
CREATE TYPE "public"."staff_role" AS ENUM('admin', 'vendedor', 'deposito');
-- +goose StatementEnd
-- +goose StatementBegin
CREATE TYPE "public"."user_role" AS ENUM('cliente', 'profesional', 'staff');
-- +goose StatementEnd
-- +goose StatementBegin
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
-- +goose StatementEnd
-- +goose StatementBegin
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL
);
-- +goose StatementEnd
-- +goose StatementBegin
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
-- +goose StatementEnd
-- +goose StatementBegin
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
-- +goose StatementEnd
-- +goose StatementBegin
CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"icon" text,
	"image" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
-- +goose StatementEnd
-- +goose StatementBegin
CREATE TABLE "product_images" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"url" text NOT NULL,
	"alt" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
-- +goose StatementEnd
-- +goose StatementBegin
CREATE TABLE "product_variants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"sku" text NOT NULL,
	"label" text NOT NULL,
	"largo_mm" integer,
	"ancho_mm" integer,
	"espesor_mm" integer,
	"material" text,
	"color" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
-- +goose StatementEnd
-- +goose StatementBegin
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"category_id" uuid NOT NULL,
	"subcategory" text,
	"description" text DEFAULT '' NOT NULL,
	"brand" text,
	"unit" "unit_of_sale" DEFAULT 'unidad' NOT NULL,
	"featured" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
-- +goose StatementEnd
-- +goose StatementBegin
CREATE TABLE "branches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"address" text DEFAULT '' NOT NULL,
	"phone" text,
	"whatsapp" text,
	"email" text,
	"hours" text,
	"map_url" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
-- +goose StatementEnd
-- +goose StatementBegin
CREATE TABLE "inventory" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"variant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"qty" integer DEFAULT 0 NOT NULL,
	"min_qty" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
-- +goose StatementEnd
-- +goose StatementBegin
CREATE TABLE "inventory_movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"variant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"type" "movement_type" NOT NULL,
	"qty" integer NOT NULL,
	"note" text,
	"transfer_group" uuid,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
-- +goose StatementEnd
-- +goose StatementBegin
CREATE TABLE "price_list_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"price_list_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"price" numeric(12, 2) NOT NULL,
	"currency" text DEFAULT 'ARS' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
-- +goose StatementEnd
-- +goose StatementBegin
CREATE TABLE "price_lists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
-- +goose StatementEnd
-- +goose StatementBegin
CREATE TABLE "profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"role" "user_role" DEFAULT 'cliente' NOT NULL,
	"staff_role" "staff_role",
	"price_list_id" uuid,
	"razon_social" text,
	"cuit" text,
	"condicion_iva" "condicion_iva" DEFAULT 'consumidor_final' NOT NULL,
	"telefono" text,
	"rubro" text,
	"notas" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE restrict ON UPDATE no action;
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE "inventory" ADD CONSTRAINT "inventory_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE cascade ON UPDATE no action;
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE "inventory" ADD CONSTRAINT "inventory_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE cascade ON UPDATE no action;
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE restrict ON UPDATE no action;
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE restrict ON UPDATE no action;
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE "price_list_items" ADD CONSTRAINT "price_list_items_price_list_id_price_lists_id_fk" FOREIGN KEY ("price_list_id") REFERENCES "public"."price_lists"("id") ON DELETE cascade ON UPDATE no action;
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE "price_list_items" ADD CONSTRAINT "price_list_items_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE cascade ON UPDATE no action;
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_price_list_id_price_lists_id_fk" FOREIGN KEY ("price_list_id") REFERENCES "public"."price_lists"("id") ON DELETE set null ON UPDATE no action;
-- +goose StatementEnd
-- +goose StatementBegin
CREATE UNIQUE INDEX "session_token_idx" ON "session" USING btree ("token");
-- +goose StatementEnd
-- +goose StatementBegin
CREATE UNIQUE INDEX "user_email_idx" ON "user" USING btree ("email");
-- +goose StatementEnd
-- +goose StatementBegin
CREATE UNIQUE INDEX "categories_slug_idx" ON "categories" USING btree ("slug");
-- +goose StatementEnd
-- +goose StatementBegin
CREATE INDEX "product_images_product_idx" ON "product_images" USING btree ("product_id");
-- +goose StatementEnd
-- +goose StatementBegin
CREATE UNIQUE INDEX "product_variants_sku_idx" ON "product_variants" USING btree ("sku");
-- +goose StatementEnd
-- +goose StatementBegin
CREATE INDEX "product_variants_product_idx" ON "product_variants" USING btree ("product_id");
-- +goose StatementEnd
-- +goose StatementBegin
CREATE UNIQUE INDEX "products_slug_idx" ON "products" USING btree ("slug");
-- +goose StatementEnd
-- +goose StatementBegin
CREATE INDEX "products_category_idx" ON "products" USING btree ("category_id");
-- +goose StatementEnd
-- +goose StatementBegin
CREATE UNIQUE INDEX "branches_slug_idx" ON "branches" USING btree ("slug");
-- +goose StatementEnd
-- +goose StatementBegin
CREATE UNIQUE INDEX "inventory_variant_branch_idx" ON "inventory" USING btree ("variant_id","branch_id");
-- +goose StatementEnd
-- +goose StatementBegin
CREATE INDEX "inventory_branch_idx" ON "inventory" USING btree ("branch_id");
-- +goose StatementEnd
-- +goose StatementBegin
CREATE INDEX "inventory_movements_variant_idx" ON "inventory_movements" USING btree ("variant_id");
-- +goose StatementEnd
-- +goose StatementBegin
CREATE INDEX "inventory_movements_branch_idx" ON "inventory_movements" USING btree ("branch_id");
-- +goose StatementEnd
-- +goose StatementBegin
CREATE INDEX "inventory_movements_created_idx" ON "inventory_movements" USING btree ("created_at");
-- +goose StatementEnd
-- +goose StatementBegin
CREATE UNIQUE INDEX "price_list_items_list_variant_idx" ON "price_list_items" USING btree ("price_list_id","variant_id");
-- +goose StatementEnd
-- +goose StatementBegin
CREATE INDEX "price_list_items_variant_idx" ON "price_list_items" USING btree ("variant_id");
-- +goose StatementEnd
-- +goose StatementBegin
CREATE UNIQUE INDEX "price_lists_slug_idx" ON "price_lists" USING btree ("slug");
-- +goose StatementEnd
-- +goose StatementBegin
CREATE UNIQUE INDEX "profiles_user_idx" ON "profiles" USING btree ("user_id");
-- +goose StatementEnd
-- +goose StatementBegin
CREATE INDEX "profiles_cuit_idx" ON "profiles" USING btree ("cuit");
-- +goose StatementEnd
-- +goose StatementBegin
CREATE INDEX "profiles_role_idx" ON "profiles" USING btree ("role");
-- +goose StatementEnd
