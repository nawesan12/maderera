CREATE TYPE "public"."direccion_mensaje" AS ENUM('entrante', 'saliente');--> statement-breakpoint
CREATE TYPE "public"."estado_conversacion" AS ENUM('abierta', 'cerrada');--> statement-breakpoint
CREATE TYPE "public"."estado_mensaje" AS ENUM('pendiente', 'enviado', 'entregado', 'leido', 'fallido');--> statement-breakpoint
CREATE TYPE "public"."tipo_media" AS ENUM('image', 'document', 'video', 'audio', 'sticker');--> statement-breakpoint
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
--> statement-breakpoint
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
--> statement-breakpoint
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
--> statement-breakpoint
CREATE TABLE "whatsapp_sesion" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"proveedor" text DEFAULT 'demo' NOT NULL,
	"conectado" boolean DEFAULT false NOT NULL,
	"telefono" text,
	"ultima_senal" timestamp with time zone,
	"detalle" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "whatsapp_conversaciones" ADD CONSTRAINT "whatsapp_conversaciones_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_conversaciones" ADD CONSTRAINT "whatsapp_conversaciones_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_conversaciones" ADD CONSTRAINT "whatsapp_conversaciones_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_conversaciones" ADD CONSTRAINT "whatsapp_conversaciones_asignado_a_user_id_user_id_fk" FOREIGN KEY ("asignado_a_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_mensajes" ADD CONSTRAINT "whatsapp_mensajes_conversacion_id_whatsapp_conversaciones_id_fk" FOREIGN KEY ("conversacion_id") REFERENCES "public"."whatsapp_conversaciones"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_mensajes" ADD CONSTRAINT "whatsapp_mensajes_enviado_por_user_id_user_id_fk" FOREIGN KEY ("enviado_por_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "whatsapp_avisos_evento_idx" ON "whatsapp_avisos" USING btree ("evento");--> statement-breakpoint
CREATE UNIQUE INDEX "whatsapp_conversaciones_jid_idx" ON "whatsapp_conversaciones" USING btree ("wa_jid");--> statement-breakpoint
CREATE INDEX "whatsapp_conversaciones_ultimo_idx" ON "whatsapp_conversaciones" USING btree ("ultimo_mensaje_at");--> statement-breakpoint
CREATE INDEX "whatsapp_conversaciones_customer_idx" ON "whatsapp_conversaciones" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "whatsapp_conversaciones_estado_idx" ON "whatsapp_conversaciones" USING btree ("estado");--> statement-breakpoint
CREATE INDEX "whatsapp_mensajes_conversacion_idx" ON "whatsapp_mensajes" USING btree ("conversacion_id","ocurrido_at");--> statement-breakpoint
CREATE UNIQUE INDEX "whatsapp_mensajes_wa_id_idx" ON "whatsapp_mensajes" USING btree ("wa_message_id");