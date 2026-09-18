ALTER TABLE "customers" ADD COLUMN "dias_credito" integer DEFAULT 30 NOT NULL;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "cuenta_bloqueada" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "motivo_bloqueo" text;