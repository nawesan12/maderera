-- WhatsApp de punta a punta: tipos de mensaje, adjuntos privados con su id de
-- Meta para reintentar la descarga, estados con el motivo del error, lo que
-- Meta cobra por cada mensaje, bajas por número, el BSUID de quien escribe sin
-- número y las plantillas sincronizadas.
CREATE TABLE "whatsapp_plantillas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"meta_id" text,
	"nombre" text NOT NULL,
	"idioma" text NOT NULL,
	"categoria" text,
	"estado" text NOT NULL,
	"motivo_rechazo" text,
	"formato_parametros" text DEFAULT 'POSITIONAL' NOT NULL,
	"componentes" jsonb NOT NULL,
	"sincronizada_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "whatsapp_conversaciones" ADD COLUMN "usuario_meta_id" text;--> statement-breakpoint
ALTER TABLE "whatsapp_conversaciones" ADD COLUMN "baja_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "whatsapp_conversaciones" ADD COLUMN "baja_detalle" text;--> statement-breakpoint
ALTER TABLE "whatsapp_conversaciones" ADD COLUMN "resuelta_por_user_id" text;--> statement-breakpoint
ALTER TABLE "whatsapp_conversaciones" ADD COLUMN "resuelta_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "whatsapp_mensajes" ADD COLUMN "tipo" text DEFAULT 'text' NOT NULL;--> statement-breakpoint
ALTER TABLE "whatsapp_mensajes" ADD COLUMN "media_id" text;--> statement-breakpoint
ALTER TABLE "whatsapp_mensajes" ADD COLUMN "media_estado" text;--> statement-breakpoint
ALTER TABLE "whatsapp_mensajes" ADD COLUMN "media_bytes" integer;--> statement-breakpoint
ALTER TABLE "whatsapp_mensajes" ADD COLUMN "citado_wa_message_id" text;--> statement-breakpoint
ALTER TABLE "whatsapp_mensajes" ADD COLUMN "datos" jsonb;--> statement-breakpoint
ALTER TABLE "whatsapp_mensajes" ADD COLUMN "reaccion_cliente" text;--> statement-breakpoint
ALTER TABLE "whatsapp_mensajes" ADD COLUMN "reaccion_nuestra" text;--> statement-breakpoint
ALTER TABLE "whatsapp_mensajes" ADD COLUMN "estado_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "whatsapp_mensajes" ADD COLUMN "error_codigo" integer;--> statement-breakpoint
ALTER TABLE "whatsapp_mensajes" ADD COLUMN "error_detalle" text;--> statement-breakpoint
ALTER TABLE "whatsapp_mensajes" ADD COLUMN "cobro_categoria" text;--> statement-breakpoint
ALTER TABLE "whatsapp_mensajes" ADD COLUMN "cobrable" boolean;--> statement-breakpoint
ALTER TABLE "whatsapp_mensajes" ADD COLUMN "origen" text;--> statement-breakpoint
ALTER TABLE "whatsapp_sesion" ADD COLUMN "ultimo_webhook_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "whatsapp_sesion" ADD COLUMN "calidad" text;--> statement-breakpoint
ALTER TABLE "whatsapp_sesion" ADD COLUMN "limite_mensajes" text;--> statement-breakpoint
ALTER TABLE "whatsapp_sesion" ADD COLUMN "diagnostico" jsonb;--> statement-breakpoint
ALTER TABLE "whatsapp_sesion" ADD COLUMN "diagnostico_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "whatsapp_plantillas_nombre_idioma_idx" ON "whatsapp_plantillas" USING btree ("nombre","idioma");--> statement-breakpoint
ALTER TABLE "whatsapp_conversaciones" ADD CONSTRAINT "whatsapp_conversaciones_resuelta_por_user_id_user_id_fk" FOREIGN KEY ("resuelta_por_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "whatsapp_conversaciones_asignado_idx" ON "whatsapp_conversaciones" USING btree ("asignado_a_user_id");--> statement-breakpoint
CREATE INDEX "whatsapp_conversaciones_usuario_meta_idx" ON "whatsapp_conversaciones" USING btree ("usuario_meta_id");--> statement-breakpoint
CREATE INDEX "whatsapp_mensajes_cobro_idx" ON "whatsapp_mensajes" USING btree ("cobrable","created_at");