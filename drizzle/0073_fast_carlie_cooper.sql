CREATE TYPE "public"."estado_tarea" AS ENUM('corriendo', 'ok', 'error');--> statement-breakpoint
CREATE TYPE "public"."estado_trabajo" AS ENUM('pendiente', 'procesando', 'hecho', 'fallido');--> statement-breakpoint
CREATE TABLE "tareas_corridas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tarea" text NOT NULL,
	"periodo" text NOT NULL,
	"estado" "estado_tarea" DEFAULT 'corriendo' NOT NULL,
	"resultado" jsonb,
	"error" text,
	"iniciada_at" timestamp with time zone DEFAULT now() NOT NULL,
	"terminada_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "trabajos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tipo" text NOT NULL,
	"carga" jsonb NOT NULL,
	"estado" "estado_trabajo" DEFAULT 'pendiente' NOT NULL,
	"intentos" integer DEFAULT 0 NOT NULL,
	"max_intentos" integer DEFAULT 8 NOT NULL,
	"proximo_intento_at" timestamp with time zone DEFAULT now() NOT NULL,
	"tomado_hasta" timestamp with time zone,
	"ultimo_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"terminado_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX "tareas_corridas_tarea_periodo_idx" ON "tareas_corridas" USING btree ("tarea","periodo");--> statement-breakpoint
CREATE INDEX "trabajos_pendientes_idx" ON "trabajos" USING btree ("proximo_intento_at") WHERE "trabajos"."estado" in ('pendiente', 'procesando');