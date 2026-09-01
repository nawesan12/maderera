CREATE TYPE "public"."estado_entrega" AS ENUM('preparada', 'entregada', 'anulada');--> statement-breakpoint
CREATE TYPE "public"."estado_envio" AS ENUM('preparando', 'despachado', 'en_transito', 'entregado', 'devuelto');--> statement-breakpoint
CREATE TYPE "public"."tipo_entrega_remito" AS ENUM('retiro', 'envio');--> statement-breakpoint
CREATE TYPE "public"."canal_notificacion" AS ENUM('email', 'whatsapp');--> statement-breakpoint
CREATE TYPE "public"."estado_notificacion" AS ENUM('enviada', 'simulada', 'fallida', 'omitida');--> statement-breakpoint
CREATE TYPE "public"."estado_cobro" AS ENUM('iniciado', 'pendiente', 'en_revision', 'aprobado', 'rechazado', 'reintegrado', 'cancelado');--> statement-breakpoint
CREATE TYPE "public"."proveedor_pago" AS ENUM('mercado_pago', 'transferencia', 'demo');--> statement-breakpoint
CREATE TYPE "public"."tipo_pago" AS ENUM('pedido', 'deuda', 'inscripcion');--> statement-breakpoint
CREATE TABLE "deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"numero" text NOT NULL,
	"order_id" uuid NOT NULL,
	"branch_id" uuid,
	"tipo" "tipo_entrega_remito" DEFAULT 'retiro' NOT NULL,
	"estado" "estado_entrega" DEFAULT 'preparada' NOT NULL,
	"receptor_nombre" text,
	"receptor_documento" text,
	"firma_url" text,
	"firmado_at" timestamp with time zone,
	"firmado_ip" text,
	"firma_token" text,
	"notas" text,
	"entregado_at" timestamp with time zone,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "delivery_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"delivery_id" uuid NOT NULL,
	"order_item_id" uuid NOT NULL,
	"cantidad" numeric(12, 2) NOT NULL,
	"orden" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shipments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"delivery_id" uuid NOT NULL,
	"transportista" text,
	"numero_seguimiento" text,
	"url_seguimiento" text,
	"estado" "estado_envio" DEFAULT 'preparando' NOT NULL,
	"despachado_at" timestamp with time zone,
	"entregado_at" timestamp with time zone,
	"observaciones" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_avisos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"evento" text NOT NULL,
	"asunto" text NOT NULL,
	"encabezado" text,
	"activo" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"canal" "canal_notificacion" NOT NULL,
	"evento" text NOT NULL,
	"destinatario" text NOT NULL,
	"asunto" text,
	"entidad_tipo" text,
	"entidad_id" uuid,
	"estado" "estado_notificacion" NOT NULL,
	"proveedor_mensaje_id" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "datos_bancarios" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"banco" text DEFAULT '' NOT NULL,
	"titular" text DEFAULT '' NOT NULL,
	"cuit" text DEFAULT '' NOT NULL,
	"cbu" text DEFAULT '' NOT NULL,
	"alias" text DEFAULT '' NOT NULL,
	"instrucciones" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"proveedor" "proveedor_pago" NOT NULL,
	"evento_id" text NOT NULL,
	"tipo" text,
	"cuerpo" jsonb,
	"firma_valida" text,
	"procesado_at" timestamp with time zone,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid,
	"customer_id" uuid,
	"tipo" "tipo_pago" DEFAULT 'pedido' NOT NULL,
	"proveedor" "proveedor_pago" NOT NULL,
	"preferencia_id" text,
	"proveedor_payment_id" text,
	"medio" text,
	"monto" numeric(12, 2) NOT NULL,
	"estado" "estado_cobro" DEFAULT 'iniciado' NOT NULL,
	"comprobante_url" text,
	"conciliado_por" text,
	"conciliado_at" timestamp with time zone,
	"account_movement_id" uuid,
	"detalle" jsonb,
	"motivo_rechazo" text,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"acreditado_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "inventory" ADD COLUMN "reservado" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_items" ADD CONSTRAINT "delivery_items_delivery_id_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."deliveries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_items" ADD CONSTRAINT "delivery_items_order_item_id_order_items_id_fk" FOREIGN KEY ("order_item_id") REFERENCES "public"."order_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_delivery_id_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."deliveries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "deliveries_numero_idx" ON "deliveries" USING btree ("numero");--> statement-breakpoint
CREATE UNIQUE INDEX "deliveries_firma_token_idx" ON "deliveries" USING btree ("firma_token");--> statement-breakpoint
CREATE INDEX "deliveries_order_idx" ON "deliveries" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "deliveries_estado_idx" ON "deliveries" USING btree ("estado");--> statement-breakpoint
CREATE INDEX "deliveries_created_idx" ON "deliveries" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "delivery_items_delivery_idx" ON "delivery_items" USING btree ("delivery_id");--> statement-breakpoint
CREATE INDEX "delivery_items_order_item_idx" ON "delivery_items" USING btree ("order_item_id");--> statement-breakpoint
CREATE INDEX "shipments_delivery_idx" ON "shipments" USING btree ("delivery_id");--> statement-breakpoint
CREATE UNIQUE INDEX "email_avisos_evento_idx" ON "email_avisos" USING btree ("evento");--> statement-breakpoint
CREATE INDEX "notifications_log_entidad_idx" ON "notifications_log" USING btree ("entidad_tipo","entidad_id");--> statement-breakpoint
CREATE INDEX "notifications_log_created_idx" ON "notifications_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "notifications_log_canal_idx" ON "notifications_log" USING btree ("canal");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_events_proveedor_evento_idx" ON "payment_events" USING btree ("proveedor","evento_id");--> statement-breakpoint
CREATE INDEX "payment_events_created_idx" ON "payment_events" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_proveedor_pago_idx" ON "payments" USING btree ("proveedor","proveedor_payment_id");--> statement-breakpoint
CREATE INDEX "payments_order_idx" ON "payments" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "payments_customer_idx" ON "payments" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "payments_estado_idx" ON "payments" USING btree ("estado");--> statement-breakpoint
CREATE INDEX "payments_created_idx" ON "payments" USING btree ("created_at");