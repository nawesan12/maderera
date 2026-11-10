"use client";

import { useActionState, useState } from "react";
import {
  CalendarDays,
  Check,
  HardHat,
  Loader2,
  Megaphone,
  Plus,
  Ticket,
  TriangleAlert,
} from "lucide-react";
import { Hoja, Interruptor, Seccion } from "@/components/admin/formulario";
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
        className="inline-flex h-10 items-center gap-2 rounded-lg bg-accion px-4 text-base font-medium text-white transition-colors hover:bg-brand-orange-dark"
      >
        <Plus className="h-5 w-5" />
        Nuevo evento
      </button>
    );
  }

  return (
    <section className="space-y-4">
      <h2 className="text-base font-medium">Nuevo evento</h2>

      <form action={accion} className="space-y-4">
        <Hoja>
          <Seccion titulo="El evento" icono={Megaphone} columnas={1}>
            <Campo nombre="titulo" etiqueta="Título" requerido />
            <Campo nombre="resumen" etiqueta="Resumen" />
            <div>
              <label
                htmlFor="descripcion"
                className="block text-base font-medium"
              >
                Descripción
              </label>
              <textarea
                id="descripcion"
                name="descripcion"
                rows={4}
                className="mt-1 w-full rounded-lg border bg-background px-3 py-2 text-base"
              />
            </div>
          </Seccion>

          <Seccion titulo="Cuándo y dónde" icono={CalendarDays}>
            <Campo
              nombre="inicia"
              etiqueta="Cuándo empieza"
              tipo="datetime-local"
              requerido
            />
            <Campo
              nombre="termina"
              etiqueta="Cuándo termina"
              tipo="datetime-local"
            />
            <div className="md:col-span-2">
              <Campo
                nombre="lugar"
                etiqueta="Dónde"
                placeholder="Casa Central, Aserradero u otra dirección"
              />
            </div>
          </Seccion>

          <Seccion titulo="Cupo y precio" icono={Ticket}>
            <Campo nombre="cupo" etiqueta="Cupo" tipo="number" defecto="0" />
            <Campo nombre="precio" etiqueta="Precio" defecto="0" />
            <div className="md:col-span-2">
              <Interruptor
                nombre="soloProfesionales"
                etiqueta="Solo para profesionales aprobados"
                icono={HardHat}
              />
            </div>
          </Seccion>
        </Hoja>

        {estado.error && (
          <p className="flex items-start gap-2 text-base text-destructive">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            {estado.error}
          </p>
        )}

        {estado.ok && (
          <p className="flex items-center gap-2 text-base text-muted-foreground">
            <Check className="h-4 w-4 text-brand-green" />
            {estado.ok}
          </p>
        )}

        <div className="flex gap-2">
          <button
            type="submit"
            disabled={creando}
            className="inline-flex h-10 items-center gap-2 rounded-lg bg-accion px-4 text-base font-medium text-white transition-colors hover:bg-brand-orange-dark disabled:opacity-60"
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
  defecto,
  placeholder,
}: {
  nombre: string;
  etiqueta: string;
  tipo?: string;
  requerido?: boolean;
  defecto?: string;
  placeholder?: string;
}) {
  return (
    <div>
      <label htmlFor={nombre} className="block text-base font-medium">
        {etiqueta}
        {requerido && (
          <span className="text-brand-orange" aria-label="obligatorio">
            {" *"}
          </span>
        )}
      </label>
      <input
        id={nombre}
        name={nombre}
        type={tipo}
        required={requerido}
        defaultValue={defecto}
        placeholder={placeholder}
        className="mt-1 h-10 w-full rounded-lg border bg-background px-3 text-base"
      />
    </div>
  );
}
