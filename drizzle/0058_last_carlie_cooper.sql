CREATE TYPE "public"."mitad_placa" AS ENUM('largo', 'ancho');--> statement-breakpoint
ALTER TABLE "cutting_orders" ADD COLUMN "placa_largo_mm" integer;--> statement-breakpoint
ALTER TABLE "cutting_orders" ADD COLUMN "placa_ancho_mm" integer;--> statement-breakpoint
ALTER TABLE "cutting_orders" ADD COLUMN "mitad" "mitad_placa";