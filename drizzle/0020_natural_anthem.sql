CREATE TYPE "public"."estado_caja" AS ENUM('abierta', 'cerrada');--> statement-breakpoint
CREATE TYPE "public"."tipo_movimiento_caja" AS ENUM('apertura', 'venta', 'ingreso', 'retiro', 'devolucion');--> statement-breakpoint
CREATE TABLE "cash_movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"tipo" "tipo_movimiento_caja" NOT NULL,
	"monto" numeric(12, 2) NOT NULL,
	"motivo" text,
	"order_id" uuid,
	"creado_por" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cash_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"branch_id" uuid NOT NULL,
	"abierta_por" text NOT NULL,
	"abierta_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cerrada_por" text,
	"cerrada_at" timestamp with time zone,
	"contado" numeric(12, 2),
	"estado" "estado_caja" DEFAULT 'abierta' NOT NULL,
	"notas" text
);
--> statement-breakpoint
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_session_id_cash_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."cash_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_creado_por_user_id_fk" FOREIGN KEY ("creado_por") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_sessions" ADD CONSTRAINT "cash_sessions_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_sessions" ADD CONSTRAINT "cash_sessions_abierta_por_user_id_fk" FOREIGN KEY ("abierta_por") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_sessions" ADD CONSTRAINT "cash_sessions_cerrada_por_user_id_fk" FOREIGN KEY ("cerrada_por") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cash_movements_sesion_idx" ON "cash_movements" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "cash_movements_pedido_idx" ON "cash_movements" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cash_sessions_una_abierta_por_sucursal" ON "cash_sessions" USING btree ("branch_id") WHERE "cash_sessions"."estado" = 'abierta';--> statement-breakpoint
CREATE INDEX "cash_sessions_abierta_idx" ON "cash_sessions" USING btree ("abierta_at");