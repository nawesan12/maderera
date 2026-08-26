"use client";

import { useActionState } from "react";
import Link from "next/link";
import { AlertCircle, Check, Loader2, Lock } from "lucide-react";
import { anotarse, type EstadoInscripcion } from "../actions";
import { formatearMonto } from "@/lib/formato";

const inicial: EstadoInscripcion = {};

/**
 * Anotarse a un evento.
 *
 * Los cuatro casos que puede tener enfrente quien mira la ficha están
 * resueltos acá y no en la página, para que ninguno quede sin respuesta:
 * ya anotado, sin cupo, reservado para profesionales, o el formulario.
 */
export function Anotarse({
  eventId,
  slug,
  precio,
  agotado,
  soloProfesionales,
  esProfesional,
  yaAnotado,
  estadoInscripcion,
  nombre,
  email,
  telefono,
  enVivo,
}: {
  eventId: string;
  slug: string;
  precio: number;
  agotado: boolean;
  soloProfesionales: boolean;
  esProfesional: boolean;
  yaAnotado: boolean;
  estadoInscripcion: string | null;
  nombre?: string | null;
  email?: string | null;
  telefono?: string | null;
  enVivo: boolean;
}) {
  const [estado, accion, enviando] = useActionState(anotarse, inicial);

  if (estado.ok) {
    return (
      <div className="rounded-xl border border-brand-green/30 bg-brand-green/5 p-5 text-center">
        <span className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-brand-green">
          <Check className="h-5 w-5 text-white" strokeWidth={3} />
        </span>
        <p className="font-medium">{estado.ok}</p>
      </div>
    );
  }

  if (yaAnotado) {
    return (
      <div className="rounded-xl border bg-white p-5">
        <p className="flex items-start gap-2 font-medium">
          <Check className="mt-0.5 h-5 w-5 shrink-0 text-brand-green" />
          {estadoInscripcion === "reservada"
            ? "Tenés el lugar reservado"
            : "Ya estás anotado"}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          {estadoInscripcion === "reservada"
            ? "Nos falta recibir el pago para confirmarlo. Si quedó a medias, escribinos y lo resolvemos."
            : "Te esperamos. Si no vas a poder venir, avisanos así le damos el lugar a otra persona."}
        </p>
      </div>
    );
  }

  if (soloProfesionales && !esProfesional) {
    return (
      <div className="rounded-xl border bg-white p-5">
        <p className="flex items-start gap-2 font-medium">
          <Lock className="mt-0.5 h-5 w-5 shrink-0 text-brand-orange" />
          Es para clientes profesionales
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          Pedí tu acceso al portal y te anotamos.
        </p>
        <Link
          href="/profesionales"
          className="mt-4 inline-flex h-11 items-center rounded-lg bg-brand-orange px-5 font-medium text-white transition-colors hover:bg-brand-orange-dark"
        >
          Pedir acceso
        </Link>
      </div>
    );
  }

  if (agotado) {
    return (
      <div className="rounded-xl border bg-white p-5">
        <p className="font-medium">Se agotaron los lugares</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Escribinos por WhatsApp y te avisamos si se libera alguno o si
          repetimos la fecha.
        </p>
        <a
          href="https://wa.me/542235903118"
          target="_blank"
          rel="noopener noreferrer"
          className="mt-4 inline-flex h-11 items-center rounded-lg border px-5 font-medium transition-colors hover:bg-muted"
        >
          Avisenme si hay lugar
        </a>
      </div>
    );
  }

  return (
    <form action={accion} className="space-y-3 rounded-xl border bg-white p-5">
      <input type="hidden" name="eventId" value={eventId} />
      <input type="hidden" name="slug" value={slug} />

      <div>
        <p className="font-medium">
          {precio > 0 ? `Anotate por ${formatearMonto(precio)}` : "Anotate"}
        </p>
        <p className="text-sm text-muted-foreground">
          {precio > 0
            ? "Te llevamos al pago y confirmamos el lugar al acreditarse."
            : "Sin cargo. Te confirmamos por correo."}
        </p>
      </div>

      <Campo
        nombre="nombre"
        etiqueta="Nombre y apellido"
        defecto={nombre}
        autoComplete="name"
        requerido
      />
      <Campo
        nombre="email"
        etiqueta="Correo"
        tipo="email"
        defecto={email}
        autoComplete="email"
        requerido
      />
      <Campo
        nombre="telefono"
        etiqueta="Teléfono"
        defecto={telefono}
        autoComplete="tel"
      />

      {estado.error && (
        <p className="flex items-start gap-2 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          {estado.error}
        </p>
      )}

      <button
        type="submit"
        disabled={enviando}
        className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-brand-orange text-base font-medium text-white transition-colors hover:bg-brand-orange-dark disabled:opacity-60"
      >
        {enviando ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            {precio > 0 ? "Abriendo el pago…" : "Anotando…"}
          </>
        ) : precio > 0 ? (
          "Anotarme y pagar"
        ) : (
          "Anotarme"
        )}
      </button>

      {precio > 0 && !enVivo && (
        <p className="text-sm text-muted-foreground">
          Los cobros están en modo de prueba: no se mueve plata.
        </p>
      )}
    </form>
  );
}

function Campo({
  nombre,
  etiqueta,
  tipo = "text",
  defecto,
  autoComplete,
  requerido = false,
}: {
  nombre: string;
  etiqueta: string;
  tipo?: string;
  defecto?: string | null;
  autoComplete?: string;
  requerido?: boolean;
}) {
  return (
    <div>
      <label htmlFor={nombre} className="block text-sm font-medium">
        {etiqueta}
        {requerido && <span className="text-brand-orange"> *</span>}
      </label>
      <input
        id={nombre}
        name={nombre}
        type={tipo}
        required={requerido}
        defaultValue={defecto ?? undefined}
        autoComplete={autoComplete}
        className="mt-1 h-11 w-full rounded-lg border bg-background px-3 text-base"
      />
    </div>
  );
}
