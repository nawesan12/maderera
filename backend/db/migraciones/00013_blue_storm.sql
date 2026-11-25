-- Migración 0012 de drizzle (0012_blue_storm), pasada a goose el 24/10/2026.
-- Historia congelada: no se edita (ver backend/db/convertir-drizzle.py).

-- +goose Up
-- +goose StatementBegin
CREATE TYPE "public"."tipo_relacion_producto" AS ENUM('complementario', 'similar');
-- +goose StatementEnd
-- +goose StatementBegin
CREATE TYPE "public"."estado_publicacion" AS ENUM('borrador', 'publicado', 'archivado');
-- +goose StatementEnd
-- +goose StatementBegin
CREATE TABLE "related_products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"related_product_id" uuid NOT NULL,
	"tipo" "tipo_relacion_producto" DEFAULT 'complementario' NOT NULL,
	"orden" integer DEFAULT 0 NOT NULL
);
-- +goose StatementEnd
-- +goose StatementBegin
CREATE TABLE "blog_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"nombre" text NOT NULL,
	"descripcion" text,
	"orden" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
-- +goose StatementEnd
-- +goose StatementBegin
CREATE TABLE "blog_posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"titulo" text NOT NULL,
	"resumen" text DEFAULT '' NOT NULL,
	"contenido" text DEFAULT '' NOT NULL,
	"imagen_url" text,
	"category_id" uuid,
	"autor" text,
	"estado" "estado_publicacion" DEFAULT 'borrador' NOT NULL,
	"publicado_at" timestamp with time zone,
	"minutos_lectura" integer DEFAULT 1 NOT NULL,
	"meta_titulo" text,
	"meta_descripcion" text,
	"destacado" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
-- +goose StatementEnd
-- +goose StatementBegin
CREATE TABLE "site_settings" (
	"clave" text PRIMARY KEY NOT NULL,
	"valor" text DEFAULT '' NOT NULL,
	"descripcion" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
-- +goose StatementEnd
-- +goose StatementBegin
CREATE TABLE "testimonials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nombre" text NOT NULL,
	"rol" text,
	"texto" text NOT NULL,
	"iniciales" text,
	"orden" integer DEFAULT 0 NOT NULL,
	"activo" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE "related_products" ADD CONSTRAINT "related_products_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE "related_products" ADD CONSTRAINT "related_products_related_product_id_products_id_fk" FOREIGN KEY ("related_product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE "blog_posts" ADD CONSTRAINT "blog_posts_category_id_blog_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."blog_categories"("id") ON DELETE set null ON UPDATE no action;
-- +goose StatementEnd
-- +goose StatementBegin
CREATE UNIQUE INDEX "related_products_par_idx" ON "related_products" USING btree ("product_id","related_product_id","tipo");
-- +goose StatementEnd
-- +goose StatementBegin
CREATE INDEX "related_products_producto_idx" ON "related_products" USING btree ("product_id","tipo");
-- +goose StatementEnd
-- +goose StatementBegin
CREATE UNIQUE INDEX "blog_categories_slug_idx" ON "blog_categories" USING btree ("slug");
-- +goose StatementEnd
-- +goose StatementBegin
CREATE UNIQUE INDEX "blog_posts_slug_idx" ON "blog_posts" USING btree ("slug");
-- +goose StatementEnd
-- +goose StatementBegin
CREATE INDEX "blog_posts_estado_idx" ON "blog_posts" USING btree ("estado","publicado_at");
-- +goose StatementEnd
-- +goose StatementBegin
CREATE INDEX "blog_posts_categoria_idx" ON "blog_posts" USING btree ("category_id");
-- +goose StatementEnd
-- +goose StatementBegin
CREATE INDEX "testimonials_activo_idx" ON "testimonials" USING btree ("activo","orden");
-- +goose StatementEnd
