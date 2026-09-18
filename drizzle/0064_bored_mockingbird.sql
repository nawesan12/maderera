CREATE TYPE "public"."etapa_seguimiento" AS ENUM('pendiente', 'hablando', 'promesa', 'cerrado');--> statement-breakpoint
CREATE TABLE "customer_follow_ups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"etapa" "etapa_seguimiento" DEFAULT 'pendiente' NOT NULL,
	"asunto" text NOT NULL,
	"notas" text,
	"proxima_accion_at" timestamp with time zone,
	"responsable_user_id" text,
	"creado_por" text,
	"cerrado_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "customer_follow_ups" ADD CONSTRAINT "customer_follow_ups_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "customer_follow_ups_cliente_idx" ON "customer_follow_ups" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "customer_follow_ups_proxima_idx" ON "customer_follow_ups" USING btree ("etapa","proxima_accion_at");