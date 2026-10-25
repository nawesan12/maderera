-- Lo propio del correo (internal/correo), la primera migración nueva de Go.
--
-- El correo vive en el IMAP; estas tablas guardan lo que el IMAP no sabe:
-- quién tiene cada conversación de una casilla compartida y en qué estado
-- está, las notas internas (el cliente nunca las ve), los seguimientos
-- («si no contesta en N días, avisame») y las respuestas guardadas.
--
-- Una conversación se identifica por la casilla y el Message-ID de su
-- primer mensaje (el primero de References, o el propio si no hay): así la
-- respuesta del cliente cae en la misma.

-- +goose Up
-- +goose StatementBegin
CREATE TABLE "correo_hilos" (
	"casilla" text NOT NULL,
	"hilo" text NOT NULL,
	"asunto" text DEFAULT '' NOT NULL,
	"remitente" text DEFAULT '' NOT NULL,
	"estado" text DEFAULT 'nuevo' NOT NULL,
	"asignado_a" text,
	"recibido_at" timestamp with time zone,
	"respondido_at" timestamp with time zone,
	"respondido_por" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "correo_hilos_pk" PRIMARY KEY ("casilla", "hilo"),
	CONSTRAINT "correo_hilos_estado_check" CHECK ("estado" IN ('nuevo', 'en-curso', 'esperando', 'resuelto')),
	CONSTRAINT "correo_hilos_asignado_fk" FOREIGN KEY ("asignado_a") REFERENCES "public"."user"("id") ON DELETE set null,
	CONSTRAINT "correo_hilos_respondido_fk" FOREIGN KEY ("respondido_por") REFERENCES "public"."user"("id") ON DELETE set null
);
-- +goose StatementEnd
-- +goose StatementBegin
CREATE INDEX "correo_hilos_respondido_idx" ON "correo_hilos" ("respondido_at") WHERE "respondido_at" IS NOT NULL;
-- +goose StatementEnd
-- +goose StatementBegin
CREATE TABLE "correo_notas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"casilla" text NOT NULL,
	"hilo" text NOT NULL,
	"autor_id" text,
	"autor" text NOT NULL,
	"texto" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "correo_notas_autor_fk" FOREIGN KEY ("autor_id") REFERENCES "public"."user"("id") ON DELETE set null
);
-- +goose StatementEnd
-- +goose StatementBegin
CREATE INDEX "correo_notas_hilo_idx" ON "correo_notas" ("casilla", "hilo", "created_at");
-- +goose StatementEnd
-- +goose StatementBegin
CREATE TABLE "correo_seguimientos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"casilla" text NOT NULL,
	"hilo" text NOT NULL,
	"para" text NOT NULL,
	"asunto" text DEFAULT '' NOT NULL,
	"enviado_at" timestamp with time zone NOT NULL,
	"vence_at" timestamp with time zone NOT NULL,
	"creado_por" text,
	"estado" text DEFAULT 'pendiente' NOT NULL,
	"resuelto_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "correo_seguimientos_estado_check" CHECK ("estado" IN ('pendiente', 'contesto', 'cancelado')),
	CONSTRAINT "correo_seguimientos_creado_fk" FOREIGN KEY ("creado_por") REFERENCES "public"."user"("id") ON DELETE set null
);
-- +goose StatementEnd
-- +goose StatementBegin
CREATE INDEX "correo_seguimientos_pendientes_idx" ON "correo_seguimientos" ("casilla", "vence_at") WHERE "estado" = 'pendiente';
-- +goose StatementEnd
-- +goose StatementBegin
CREATE TABLE "correo_plantillas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"casilla" text NOT NULL,
	"titulo" text NOT NULL,
	"atajo" text DEFAULT '' NOT NULL,
	"texto" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "correo_plantillas_titulo_unico" UNIQUE ("casilla", "titulo")
);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE "correo_plantillas";
-- +goose StatementEnd
-- +goose StatementBegin
DROP TABLE "correo_seguimientos";
-- +goose StatementEnd
-- +goose StatementBegin
DROP TABLE "correo_notas";
-- +goose StatementEnd
-- +goose StatementBegin
DROP TABLE "correo_hilos";
-- +goose StatementEnd
