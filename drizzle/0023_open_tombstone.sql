CREATE TABLE "pos_devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"codigo" text NOT NULL,
	"nombre" text,
	"branch_id" uuid,
	"secreto" text NOT NULL,
	"activo" boolean DEFAULT true NOT NULL,
	"ultima_vez_at" timestamp with time zone,
	"pendientes" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "numero_provisorio" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "cobrada_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "sincronizada_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "cash_movements" ADD COLUMN "clave" text;--> statement-breakpoint
ALTER TABLE "pos_devices" ADD CONSTRAINT "pos_devices_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pos_devices_codigo_idx" ON "pos_devices" USING btree ("codigo");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_numero_provisorio_idx" ON "orders" USING btree ("numero_provisorio");--> statement-breakpoint
CREATE UNIQUE INDEX "cash_movements_clave_idx" ON "cash_movements" USING btree ("clave");