CREATE TYPE "public"."tipo_documento" AS ENUM('dni', 'cuit');--> statement-breakpoint
ALTER TYPE "public"."rubro_profesional" ADD VALUE 'woodframer' BEFORE 'otro';--> statement-breakpoint
ALTER TABLE "professional_applications" ALTER COLUMN "cuit" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "professional_applications" ADD COLUMN "documento_tipo" "tipo_documento" DEFAULT 'cuit' NOT NULL;--> statement-breakpoint
ALTER TABLE "professional_applications" ADD COLUMN "documento_numero" text;--> statement-breakpoint
ALTER TABLE "professional_applications" ADD COLUMN "red_social" text;--> statement-breakpoint
UPDATE "professional_applications" SET "documento_numero" = "cuit" WHERE "documento_numero" IS NULL;--> statement-breakpoint
ALTER TABLE "professional_applications" ALTER COLUMN "documento_numero" SET NOT NULL;--> statement-breakpoint
CREATE INDEX "professional_applications_documento_idx" ON "professional_applications" USING btree ("documento_numero");
