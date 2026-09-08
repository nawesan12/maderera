ALTER TYPE "public"."unit_of_sale" ADD VALUE 'tabla' BEFORE 'placa';--> statement-breakpoint
CREATE TABLE "calculator_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"merma_machimbre" numeric(5, 4) DEFAULT '0.2' NOT NULL,
	"factor_pendiente" numeric(5, 4) DEFAULT '0.15' NOT NULL,
	"margen_seguridad" numeric(5, 4) DEFAULT '0.12' NOT NULL,
	"ancho_sierra_mm" integer DEFAULT 5 NOT NULL,
	"rinde_rollo_membrana" numeric(6, 2) DEFAULT '9' NOT NULL,
	"rinde_rollo_aislacion" numeric(6, 2) DEFAULT '21.6' NOT NULL,
	"separacion_techo_m" numeric(4, 2) DEFAULT '0.6' NOT NULL,
	"separacion_piso_m" numeric(4, 2) DEFAULT '0.4' NOT NULL,
	"deck_grandis_largo_m" numeric(5, 2) DEFAULT '2.40' NOT NULL,
	"deck_grandis_ancho_m" numeric(5, 3) DEFAULT '0.100' NOT NULL,
	"deck_pvc_largo_m" numeric(5, 2) DEFAULT '2.90' NOT NULL,
	"deck_pvc_ancho_m" numeric(5, 3) DEFAULT '0.140' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
