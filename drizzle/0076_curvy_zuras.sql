CREATE TYPE "public"."estado_campana" AS ENUM('borrador', 'programada', 'enviando', 'enviada', 'cancelada');--> statement-breakpoint
CREATE TYPE "public"."estado_envio_campana" AS ENUM('pendiente', 'enviado', 'fallido', 'omitido');--> statement-breakpoint
CREATE TABLE "bajas_de_correo" (
	"email" text PRIMARY KEY NOT NULL,
	"origen" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campana_envios" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campana_id" uuid NOT NULL,
	"customer_id" uuid,
	"email" text NOT NULL,
	"nombre" text,
	"estado" "estado_envio_campana" DEFAULT 'pendiente' NOT NULL,
	"error" text,
	"enviado_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "campanas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asunto" text NOT NULL,
	"adelanto" text,
	"cuerpo" text NOT NULL,
	"imagen_url" text,
	"boton_texto" text,
	"boton_url" text,
	"segmento" jsonb NOT NULL,
	"estado" "estado_campana" DEFAULT 'borrador' NOT NULL,
	"programada_para" timestamp with time zone,
	"creada_por_user_id" text,
	"creada_por_nombre" text,
	"iniciada_at" timestamp with time zone,
	"terminada_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "campana_envios" ADD CONSTRAINT "campana_envios_campana_id_campanas_id_fk" FOREIGN KEY ("campana_id") REFERENCES "public"."campanas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campana_envios" ADD CONSTRAINT "campana_envios_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "campana_envios_email_idx" ON "campana_envios" USING btree ("campana_id",lower("email"));--> statement-breakpoint
CREATE INDEX "campana_envios_pendientes_idx" ON "campana_envios" USING btree ("campana_id") WHERE "campana_envios"."estado" = 'pendiente';--> statement-breakpoint
CREATE INDEX "campanas_estado_idx" ON "campanas" USING btree ("estado","programada_para");