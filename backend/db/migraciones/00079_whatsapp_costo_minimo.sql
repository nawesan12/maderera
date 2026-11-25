-- Migración 0078 de drizzle (0078_whatsapp_costo_minimo), pasada a goose el 24/10/2026.
-- Historia congelada: no se edita (ver backend/db/convertir-drizzle.py).

-- +goose Up
-- +goose StatementBegin
-- WhatsApp con el menor costo posible: el aviso a mano desde la app del
-- teléfono queda en la bitácora con su propio canal (y quién lo mandó), el
-- tope de gasto del mes con las tarifas de Meta y los avisos de 80 % y 100 %,
-- y la marca de lo que entró con el historial de la coexistencia.
ALTER TYPE "public"."canal_notificacion" ADD VALUE 'whatsapp_manual';
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE "notifications_log" ADD COLUMN "usuario_id" text;
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE "whatsapp_mensajes" ADD COLUMN "importado" boolean DEFAULT false NOT NULL;
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE "whatsapp_sesion" ADD COLUMN "tope_mensual_usd" numeric(10, 2) DEFAULT '10' NOT NULL;
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE "whatsapp_sesion" ADD COLUMN "tarifas" jsonb;
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE "whatsapp_sesion" ADD COLUMN "tope_aviso80" text;
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE "whatsapp_sesion" ADD COLUMN "tope_aviso100" text;
-- +goose StatementEnd
-- +goose StatementBegin
CREATE INDEX "notifications_log_evento_idx" ON "notifications_log" USING btree ("evento","entidad_id");
-- +goose StatementEnd
