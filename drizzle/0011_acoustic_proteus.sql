CREATE TYPE "public"."estado_evento" AS ENUM('borrador', 'publicado', 'cerrado', 'cancelado');--> statement-breakpoint
CREATE TYPE "public"."estado_inscripcion" AS ENUM('reservada', 'confirmada', 'asistio', 'ausente', 'cancelada');--> statement-breakpoint
CREATE TYPE "public"."estado_solicitud" AS ENUM('pendiente', 'aprobada', 'rechazada');--> statement-breakpoint
CREATE TYPE "public"."rubro_profesional" AS ENUM('arquitecto', 'constructora', 'carpintero', 'disenador', 'instalador', 'otro');--> statement-breakpoint
ALTER TYPE "public"."origen_presupuesto" ADD VALUE 'express';--> statement-breakpoint
CREATE TABLE "event_registrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"customer_id" uuid,
	"user_id" text,
	"nombre" text NOT NULL,
	"email" text NOT NULL,
	"telefono" text,
	"estado" "estado_inscripcion" DEFAULT 'reservada' NOT NULL,
	"payment_id" uuid,
	"recordado_at" timestamp with time zone,
	"notas" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"titulo" text NOT NULL,
	"resumen" text,
	"descripcion" text,
	"imagen_url" text,
	"lugar" text,
	"branch_id" uuid,
	"inicia" timestamp with time zone NOT NULL,
	"termina" timestamp with time zone,
	"cupo" integer DEFAULT 0 NOT NULL,
	"precio" numeric(12, 2) DEFAULT '0' NOT NULL,
	"solo_profesionales" boolean DEFAULT false NOT NULL,
	"estado" "estado_evento" DEFAULT 'borrador' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "professional_applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text,
	"customer_id" uuid,
	"nombre" text NOT NULL,
	"razon_social" text,
	"cuit" text NOT NULL,
	"email" text NOT NULL,
	"telefono" text NOT NULL,
	"rubro" "rubro_profesional" DEFAULT 'otro' NOT NULL,
	"matricula" text,
	"volumen_estimado" text,
	"localidad" text,
	"mensaje" text,
	"estado" "estado_solicitud" DEFAULT 'pendiente' NOT NULL,
	"motivo_rechazo" text,
	"resuelto_por" text,
	"resuelto_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "technical_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"titulo" text NOT NULL,
	"descripcion" text,
	"categoria" text DEFAULT 'general' NOT NULL,
	"url" text NOT NULL,
	"formato" text DEFAULT 'pdf' NOT NULL,
	"tamano_bytes" integer,
	"solo_profesionales" boolean DEFAULT true NOT NULL,
	"descargas" integer DEFAULT 0 NOT NULL,
	"activo" boolean DEFAULT true NOT NULL,
	"orden" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "volume_discounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"price_list_id" uuid NOT NULL,
	"variant_id" uuid,
	"category_id" uuid,
	"desde_cantidad" numeric(12, 2) NOT NULL,
	"porcentaje" numeric(5, 2) NOT NULL,
	"activo" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "responde_hasta" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "event_registrations" ADD CONSTRAINT "event_registrations_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_registrations" ADD CONSTRAINT "event_registrations_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_registrations" ADD CONSTRAINT "event_registrations_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "professional_applications" ADD CONSTRAINT "professional_applications_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "professional_applications" ADD CONSTRAINT "professional_applications_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "volume_discounts" ADD CONSTRAINT "volume_discounts_price_list_id_price_lists_id_fk" FOREIGN KEY ("price_list_id") REFERENCES "public"."price_lists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "event_registrations_evento_email_idx" ON "event_registrations" USING btree ("event_id","email");--> statement-breakpoint
CREATE INDEX "event_registrations_evento_idx" ON "event_registrations" USING btree ("event_id","estado");--> statement-breakpoint
CREATE UNIQUE INDEX "events_slug_idx" ON "events" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "events_estado_idx" ON "events" USING btree ("estado");--> statement-breakpoint
CREATE INDEX "events_inicia_idx" ON "events" USING btree ("inicia");--> statement-breakpoint
CREATE INDEX "professional_applications_estado_idx" ON "professional_applications" USING btree ("estado");--> statement-breakpoint
CREATE INDEX "professional_applications_cuit_idx" ON "professional_applications" USING btree ("cuit");--> statement-breakpoint
CREATE INDEX "professional_applications_created_idx" ON "professional_applications" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "technical_documents_categoria_idx" ON "technical_documents" USING btree ("categoria","activo");--> statement-breakpoint
CREATE INDEX "volume_discounts_lista_idx" ON "volume_discounts" USING btree ("price_list_id","activo");--> statement-breakpoint
CREATE INDEX "volume_discounts_variant_idx" ON "volume_discounts" USING btree ("variant_id");--> statement-breakpoint
CREATE INDEX "volume_discounts_category_idx" ON "volume_discounts" USING btree ("category_id");