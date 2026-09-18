CREATE TABLE "rate_limits" (
	"clave" text NOT NULL,
	"ventana" timestamp with time zone NOT NULL,
	"cuenta" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "rate_limits_clave_ventana_pk" PRIMARY KEY("clave","ventana")
);
