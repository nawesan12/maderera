CREATE TYPE "public"."quien_paga_promo" AS ENUM('banco', 'nosotros');--> statement-breakpoint
ALTER TABLE "bank_promotions" ADD COLUMN "quien_paga" "quien_paga_promo" DEFAULT 'banco' NOT NULL;