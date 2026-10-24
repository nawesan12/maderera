-- Migración 0041 de drizzle (0041_romantic_psynapse), pasada a goose el 24/10/2026.
-- Historia congelada: no se edita (ver backend/db/convertir-drizzle.py).

-- +goose Up
-- +goose StatementBegin
CREATE TABLE "subcategories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"category_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE "products" ADD COLUMN "subcategory_id" uuid;
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE "subcategories" ADD CONSTRAINT "subcategories_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action;
-- +goose StatementEnd
-- +goose StatementBegin
CREATE UNIQUE INDEX "subcategories_categoria_slug_idx" ON "subcategories" USING btree ("category_id","slug");
-- +goose StatementEnd
-- +goose StatementBegin
CREATE INDEX "subcategories_categoria_idx" ON "subcategories" USING btree ("category_id");
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE "products" ADD CONSTRAINT "products_subcategory_id_subcategories_id_fk" FOREIGN KEY ("subcategory_id") REFERENCES "public"."subcategories"("id") ON DELETE set null ON UPDATE no action;
-- +goose StatementEnd
-- +goose StatementBegin
CREATE INDEX "products_subcategory_idx" ON "products" USING btree ("subcategory_id");
-- +goose StatementEnd
