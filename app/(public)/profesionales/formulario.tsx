"use client";

import { useActionState } from "react";
import { AlertCircle, Check, Loader2, Send } from "lucide-react";
import { solicitarAcceso, type EstadoSolicitud } from "./actions";

const inicial: EstadoSolicitud = {};

const RUBROS = [
  { valor: "arquitecto", texto: "Arquitecto o arquitecta" },
  { valor: "constructora", texto: "Constructora o desarrollo" },
  { valor: "carpintero", texto: "Carpintería" },
  { valor: "disenador", texto: "Diseño de interiores" },
  { valor: "instalador", texto: "Instalación o colocación" },
  { valor: "otro", texto: "Otro" },
];

/**
 * Solicitud de acceso profesional.
 *
 * El formulario que había antes no mandaba nada: eran campos sueltos sin acción.
 * Este crea una solicitud real que cae en el panel.
 *
 * Se piden pocos datos y todos con un porqué: el CUIT porque sin él no se puede
 * facturar A, el rubro porque decide qué lista de precios corresponde, y el
 * volumen estimado porque es lo que el vendedor mira para poner el límite de
 * cuenta corriente. Cada campo de más es gente que abandona a mitad.
 */
export function FormularioProfesional({
  emailSugerido,
  nombreSugerido,
}: {
  emailSugerido?: string | null;
  nombreSugerido?: string | null;
}) {
  const [estado, accion, enviando] = useActionState(solicitarAcceso, inicial);

  if (estado.ok) {
    return (
      <div className="rounded-xl border border-brand-green/30 bg-brand-green/5 p-6 text-center">
        <span className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-brand-green">
          <Check className="h-6 w-6 text-white" strokeWidth={3} />
        </span>
        <p className="text-lg font-semibold">Listo</p>
        <p className="mt-1 text-muted-foreground">{estado.ok}</p>
      </div>
    );
  }

  return (
    <form action={accion} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo
          nombre="nombre"
          etiqueta="Nombre y apellido"
          requerido
          defecto={nombreSugerido}
          autoComplete="name"
        />
        <Campo
          nombre="razonSocial"
          etiqueta="Empresa"
          ayuda="Si facturás a nombre de una empresa"
          autoComplete="organization"
        />
        <Campo
          nombre="cuit"
          etiqueta="CUIT"
          requerido
          placeholder="30-71234567-1"
          ayuda="Lo verificamos antes de habilitarte"
          inputMode="numeric"
        />
        <div>
          <label htmlFor="rubro" className="block text-sm font-medium">
            A qué te dedicás <span className="text-brand-orange">*</span>
          </label>
          <select
            id="rubro"
            name="rubro"
            required
            defaultValue="arquitecto"
            className="mt-1 h-11 w-full rounded-lg border bg-background px-3 text-base"
          >
            {RUBROS.map((r) => (
              <option key={r.valor} value={r.valor}>
                {r.texto}
              </option>
            ))}
          </select>
        </div>
        <Campo
          nombre="email"
          etiqueta="Correo"
          tipo="email"
          requerido
          defecto={emailSugerido}
          autoComplete="email"
        />
        <Campo
          nombre="telefono"
          etiqueta="Teléfono"
          requerido
          autoComplete="tel"
          inputMode="tel"
        />
        <Campo
          nombre="matricula"
          etiqueta="Matrícula"
          ayuda="Si tu rubro la tiene"
        />
        <Campo
          nombre="localidad"
          etiqueta="Dónde trabajás"
          placeholder="Mar del Plata"
        />
        <div className="sm:col-span-2">
          <Campo
            nombre="volumenEstimado"
            etiqueta="Qué comprás habitualmente"
            placeholder="Placas y molduras, unas 40 por mes"
            ayuda="Nos sirve para armarte la lista y el límite de cuenta corriente"
          />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="mensaje" className="block text-sm font-medium">
            Algo más que quieras contarnos
          </label>
          <textarea
            id="mensaje"
            name="mensaje"
            rows={3}
            className="mt-1 w-full rounded-lg border bg-background px-3 py-2 text-base"
          />
        </div>
      </div>

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
            Enviando…
          </>
        ) : (
          <>
            <Send className="h-4 w-4" />
            Solicitar acceso
          </>
        )}
      </button>

      <p className="text-center text-sm text-muted-foreground">
        Te contestamos dentro de las 24 horas hábiles.
      </p>
    </form>
  );
}

function Campo({
  nombre,
  etiqueta,
  tipo = "text",
  requerido = false,
  placeholder,
  ayuda,
  defecto,
  autoComplete,
  inputMode,
}: {
  nombre: string;
  etiqueta: string;
  tipo?: string;
  requerido?: boolean;
  placeholder?: string;
  ayuda?: string;
  defecto?: string | null;
  autoComplete?: string;
  inputMode?: "numeric" | "tel" | "text";
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
        placeholder={placeholder}
        defaultValue={defecto ?? undefined}
        autoComplete={autoComplete}
        inputMode={inputMode}
        className="mt-1 h-11 w-full rounded-lg border bg-background px-3 text-base"
      />
      {ayuda && <p className="mt-1 text-sm text-muted-foreground">{ayuda}</p>}
    </div>
  );
}
