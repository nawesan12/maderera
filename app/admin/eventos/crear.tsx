"use client";

import { useActionState, useState } from "react";
import { Check, Loader2, Plus, TriangleAlert } from "lucide-react";
import { crearEvento, type EstadoEvento } from "./actions";

const inicial: EstadoEvento = {};

/**
 * Alta de un evento.
 *
 * Plegado por defecto: la pantalla se usa mucho más para mirar quién se anotó
 * que para cargar uno nuevo, y un formulario de ocho campos abierto arriba de
 * todo empuja la información hacia abajo.
 */
export function CrearEvento() {
  const [estado, accion, creando] = useActionState(crearEvento, inicial);
  const [abierto, setAbierto] = useState(false);

  if (!abierto) {
    return (
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className="inline-flex h-10 items-center gap-2 rounded-lg bg-brand-orange px-4 text-base font-medium text-white transition-colors hover:bg-brand-orange-dark"
      >
        <Plus className="h-5 w-5" />
        Nuevo evento
      </button>
    );
  }

  return (
    <section className="tarjeta p-5">
      <h2 className="text-base font-medium">Nuevo evento</h2>
      <p className="mt-0.5 text-base text-muted-foreground">
        Se crea como borrador: no se ve en el sitio hasta que lo publiques.
      </p>

      <form action={accion} className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Campo nombre="titulo" etiqueta="Título" requerido />
        </div>
        <div className="sm:col-span-2">
          <Campo
            nombre="resumen"
            etiqueta="Resumen"
            ayuda="Una línea. Es lo que se lee en la agenda."
          />
        </div>

        <Campo nombre="inicia" etiqueta="Cuándo empieza" tipo="datetime-local" requerido />
        <Campo nombre="termina" etiqueta="Cuándo termina" tipo="datetime-local" />

        <Campo nombre="lugar" etiqueta="Dónde" ayuda="Casa Central, Aserradero, u otra dirección" />
        <Campo
          nombre="cupo"
          etiqueta="Cupo"
          tipo="number"
          defecto="0"
          ayuda="Cero es sin tope"
        />

        <Campo
          nombre="precio"
          etiqueta="Precio"
          defecto="0"
          ayuda="Cero es sin cargo: la inscripción no pasa por el cobro"
        />

        <label className="flex items-end gap-2 pb-2 text-base">
          <input
            type="checkbox"
            name="soloProfesionales"
            className="h-4 w-4"
          />
          Solo para profesionales aprobados
        </label>

        <div className="sm:col-span-2">
          <label htmlFor="descripcion" className="block text-base font-medium">
            Descripción
          </label>
          <textarea
            id="descripcion"
            name="descripcion"
            rows={4}
            className="mt-1 w-full rounded-lg border bg-background px-3 py-2 text-base"
          />
        </div>

        {estado.error && (
          <p className="flex items-start gap-2 text-base text-destructive sm:col-span-2">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            {estado.error}
          </p>
        )}

        {estado.ok && (
          <p className="flex items-center gap-2 text-base text-muted-foreground sm:col-span-2">
            <Check className="h-4 w-4 text-brand-green" />
            {estado.ok}
          </p>
        )}

        <div className="flex gap-2 sm:col-span-2">
          <button
            type="submit"
            disabled={creando}
            className="inline-flex h-10 items-center gap-2 rounded-lg bg-brand-orange px-4 text-base font-medium text-white transition-colors hover:bg-brand-orange-dark disabled:opacity-60"
          >
            {creando && <Loader2 className="h-4 w-4 animate-spin" />}
            Crear
          </button>
          <button
            type="button"
            onClick={() => setAbierto(false)}
            className="inline-flex h-10 items-center rounded-lg border px-4 text-base font-medium transition-colors hover:bg-muted"
          >
            Cancelar
          </button>
        </div>
      </form>
    </section>
  );
}

function Campo({
  nombre,
  etiqueta,
  tipo = "text",
  requerido = false,
  ayuda,
  defecto,
}: {
  nombre: string;
  etiqueta: string;
  tipo?: string;
  requerido?: boolean;
  ayuda?: string;
  defecto?: string;
}) {
  return (
    <div>
      <label htmlFor={nombre} className="block text-base font-medium">
        {etiqueta}
        {requerido && <span className="text-brand-orange"> *</span>}
      </label>
      <input
        id={nombre}
        name={nombre}
        type={tipo}
        required={requerido}
        defaultValue={defecto}
        className="mt-1 h-10 w-full rounded-lg border bg-background px-3 text-base"
      />
      {ayuda && <p className="mt-1 text-base text-muted-foreground">{ayuda}</p>}
    </div>
  );
}
