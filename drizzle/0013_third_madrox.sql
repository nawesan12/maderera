CREATE TYPE "public"."entidad_migracion" AS ENUM('clientes', 'productos', 'stock', 'saldos');--> statement-breakpoint
CREATE TYPE "public"."estado_migracion" AS ENUM('en_curso', 'completada', 'interrumpida');--> statement-breakpoint
CREATE TABLE "migration_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entidad" "entidad_migracion" NOT NULL,
	"archivo" text NOT NULL,
	"codificacion" text DEFAULT 'utf-8' NOT NULL,
	"mapeo" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"filas_totales" integer DEFAULT 0 NOT NULL,
	"creados" integer DEFAULT 0 NOT NULL,
	"actualizados" integer DEFAULT 0 NOT NULL,
	"omitidos" integer DEFAULT 0 NOT NULL,
	"con_error" integer DEFAULT 0 NOT NULL,
	"rechazos" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"estado" "estado_migracion" DEFAULT 'en_curso' NOT NULL,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "codigo_legacy" text;--> statement-breakpoint
CREATE INDEX "migration_runs_entidad_idx" ON "migration_runs" USING btree ("entidad","created_at");--> statement-breakpoint
CREATE INDEX "migration_runs_created_idx" ON "migration_runs" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "customers_codigo_legacy_idx" ON "customers" USING btree ("codigo_legacy");