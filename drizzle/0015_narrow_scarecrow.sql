CREATE TYPE "public"."accion_auditoria" AS ENUM('crear', 'editar', 'eliminar', 'cambiar_estado', 'cobrar', 'anular', 'importar', 'exportar');--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"usuario_id" text,
	"usuario_nombre" text NOT NULL,
	"usuario_email" text,
	"usuario_rol" text,
	"accion" "accion_auditoria" NOT NULL,
	"entidad" text NOT NULL,
	"entidad_id" text,
	"descripcion" text NOT NULL,
	"detalle" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "audit_log_fecha_idx" ON "audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "audit_log_entidad_idx" ON "audit_log" USING btree ("entidad","entidad_id");--> statement-breakpoint
CREATE INDEX "audit_log_usuario_idx" ON "audit_log" USING btree ("usuario_id");