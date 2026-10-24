-- Migración 0007 de drizzle (0007_cultured_squadron_sinister), pasada a goose el 24/10/2026.
-- Historia congelada: no se edita (ver backend/db/convertir-drizzle.py).

-- +goose Up
-- +goose StatementBegin
CREATE TYPE "public"."direccion_mensaje" AS ENUM('entrante', 'saliente');
-- +goose StatementEnd
-- +goose StatementBegin
CREATE TYPE "public"."estado_conversacion" AS ENUM('abierta', 'cerrada');
-- +goose StatementEnd
-- +goose StatementBegin
CREATE TYPE "public"."estado_mensaje" AS ENUM('pendiente', 'enviado', 'entregado', 'leido', 'fallido');
-- +goose StatementEnd
-- +goose StatementBegin
CREATE TYPE "public"."tipo_media" AS ENUM('image', 'document', 'video', 'audio', 'sticker');
-- +goose StatementEnd
-- +goose StatementBegin
CREATE TABLE "whatsapp_avisos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"evento" text NOT NULL,
	"plantilla" text NOT NULL,
	"idioma" text DEFAULT 'es_AR' NOT NULL,
	"texto_libre" text,
	"activo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
-- +goose StatementEnd
-- +goose StatementBegin
CREATE TABLE "whatsapp_conversaciones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wa_jid" text NOT NULL,
	"display_name" text,
	"customer_id" uuid,
	"order_id" uuid,
	"branch_id" uuid,
	"estado" "estado_conversacion" DEFAULT 'abierta' NOT NULL,
	"asignado_a_user_id" text,
	"ultimo_mensaje_at" timestamp with time zone,
	"ultimo_mensaje_preview" text,
	"ultimo_entrante_at" timestamp with time zone,
	"no_leidos" integer DEFAULT 0 NOT NULL,
	"notas" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
-- +goose StatementEnd
-- +goose StatementBegin
CREATE TABLE "whatsapp_mensajes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversacion_id" uuid NOT NULL,
	"direccion" "direccion_mensaje" NOT NULL,
	"wa_message_id" text,
	"cuerpo" text DEFAULT '' NOT NULL,
	"media_url" text,
	"media_tipo" "tipo_media",
	"media_mime" text,
	"media_nombre" text,
	"estado" "estado_mensaje" DEFAULT 'enviado' NOT NULL,
	"plantilla" text,
	"enviado_por_user_id" text,
	"ocurrido_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
-- +goose StatementEnd
-- +goose StatementBegin
CREATE TABLE "whatsapp_sesion" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"proveedor" text DEFAULT 'demo' NOT NULL,
	"conectado" boolean DEFAULT false NOT NULL,
	"telefono" text,
	"ultima_senal" timestamp with time zone,
	"detalle" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE "whatsapp_conversaciones" ADD CONSTRAINT "whatsapp_conversaciones_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE "whatsapp_conversaciones" ADD CONSTRAINT "whatsapp_conversaciones_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE no action;
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE "whatsapp_conversaciones" ADD CONSTRAINT "whatsapp_conversaciones_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE set null ON UPDATE no action;
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE "whatsapp_conversaciones" ADD CONSTRAINT "whatsapp_conversaciones_asignado_a_user_id_user_id_fk" FOREIGN KEY ("asignado_a_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE "whatsapp_mensajes" ADD CONSTRAINT "whatsapp_mensajes_conversacion_id_whatsapp_conversaciones_id_fk" FOREIGN KEY ("conversacion_id") REFERENCES "public"."whatsapp_conversaciones"("id") ON DELETE cascade ON UPDATE no action;
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE "whatsapp_mensajes" ADD CONSTRAINT "whatsapp_mensajes_enviado_por_user_id_user_id_fk" FOREIGN KEY ("enviado_por_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
-- +goose StatementEnd
-- +goose StatementBegin
CREATE UNIQUE INDEX "whatsapp_avisos_evento_idx" ON "whatsapp_avisos" USING btree ("evento");
-- +goose StatementEnd
-- +goose StatementBegin
CREATE UNIQUE INDEX "whatsapp_conversaciones_jid_idx" ON "whatsapp_conversaciones" USING btree ("wa_jid");
-- +goose StatementEnd
-- +goose StatementBegin
CREATE INDEX "whatsapp_conversaciones_ultimo_idx" ON "whatsapp_conversaciones" USING btree ("ultimo_mensaje_at");
-- +goose StatementEnd
-- +goose StatementBegin
CREATE INDEX "whatsapp_conversaciones_customer_idx" ON "whatsapp_conversaciones" USING btree ("customer_id");
-- +goose StatementEnd
-- +goose StatementBegin
CREATE INDEX "whatsapp_conversaciones_estado_idx" ON "whatsapp_conversaciones" USING btree ("estado");
-- +goose StatementEnd
-- +goose StatementBegin
CREATE INDEX "whatsapp_mensajes_conversacion_idx" ON "whatsapp_mensajes" USING btree ("conversacion_id","ocurrido_at");
-- +goose StatementEnd
-- +goose StatementBegin
CREATE UNIQUE INDEX "whatsapp_mensajes_wa_id_idx" ON "whatsapp_mensajes" USING btree ("wa_message_id");
-- +goose StatementEnd
