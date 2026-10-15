-- WhatsApp con el menor costo posible: el aviso a mano desde la app del
-- teléfono queda en la bitácora con su propio canal (y quién lo mandó), el
-- tope de gasto del mes con las tarifas de Meta y los avisos de 80 % y 100 %,
-- y la marca de lo que entró con el historial de la coexistencia.
ALTER TYPE "public"."canal_notificacion" ADD VALUE 'whatsapp_manual';--> statement-breakpoint
ALTER TABLE "notifications_log" ADD COLUMN "usuario_id" text;--> statement-breakpoint
ALTER TABLE "whatsapp_mensajes" ADD COLUMN "importado" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "whatsapp_sesion" ADD COLUMN "tope_mensual_usd" numeric(10, 2) DEFAULT '10' NOT NULL;--> statement-breakpoint
ALTER TABLE "whatsapp_sesion" ADD COLUMN "tarifas" jsonb;--> statement-breakpoint
ALTER TABLE "whatsapp_sesion" ADD COLUMN "tope_aviso80" text;--> statement-breakpoint
ALTER TABLE "whatsapp_sesion" ADD COLUMN "tope_aviso100" text;--> statement-breakpoint
CREATE INDEX "notifications_log_evento_idx" ON "notifications_log" USING btree ("evento","entidad_id");