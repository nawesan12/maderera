CREATE TYPE "public"."estado_proveedor" AS ENUM('activo', 'inactivo');--> statement-breakpoint
CREATE TYPE "public"."tipo_movimiento_proveedor" AS ENUM('factura', 'pago', 'nota_credito', 'nota_debito', 'ajuste');--> statement-breakpoint
CREATE TABLE "supplier_movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"supplier_id" uuid NOT NULL,
	"tipo" "tipo_movimiento_proveedor" NOT NULL,
	"monto" numeric(12, 2) NOT NULL,
	"detalle" text,
	"referencia" text,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "suppliers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nombre" text NOT NULL,
	"razon_social" text,
	"cuit" text,
	"condicion_iva" "condicion_iva" DEFAULT 'responsable_inscripto' NOT NULL,
	"email" text,
	"telefono" text,
	"direccion" text,
	"rubro" text,
	"contacto" text,
	"dias_pago" integer DEFAULT 0 NOT NULL,
	"cbu" text,
	"alias_cbu" text,
	"estado" "estado_proveedor" DEFAULT 'activo' NOT NULL,
	"notas" text,
	"codigo_legacy" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "supplier_movements" ADD CONSTRAINT "supplier_movements_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_movements" ADD CONSTRAINT "supplier_movements_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "supplier_movements_supplier_idx" ON "supplier_movements" USING btree ("supplier_id");--> statement-breakpoint
CREATE INDEX "supplier_movements_created_idx" ON "supplier_movements" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "suppliers_nombre_idx" ON "suppliers" USING btree ("nombre");--> statement-breakpoint
CREATE INDEX "suppliers_cuit_idx" ON "suppliers" USING btree ("cuit");--> statement-breakpoint
CREATE UNIQUE INDEX "suppliers_codigo_legacy_idx" ON "suppliers" USING btree ("codigo_legacy");