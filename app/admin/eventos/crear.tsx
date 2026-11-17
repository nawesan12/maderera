"use client";

import { useActionState, useState } from "react";
import {
  CalendarDays,
  Check,
  HardHat,
  Loader2,
  Megaphone,
  Pencil,
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
/** Lo que se edita de un evento ya cargado. */
export interface EventoEditable {
  id: string;
  titulo: string;
  resumen: string | null;
  descripcion: string | null;
  lugar: string | null;
  inicia: Date;
  termina: Date | null;
  cupo: number;
  precio: number;
  soloProfesionales: boolean;
}

/** Para un `datetime-local`: la hora de Argentina, sin zona. */
function paraCampo(fecha: Date | null): string | undefined {
  if (!fecha) return undefined;
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(fecha);
  const v = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return `${v("year")}-${v("month")}-${v("day")}T${v("hour")}:${v("minute")}`;
}

/**
 * Con un evento, el mismo formulario lo corrige: antes una fecha mal cargada
 * obligaba a hacer otro evento.
 */
export function CrearEvento({ evento }: { evento?: EventoEditable } = {}) {
  const [estado, accion, creando] = useActionState(crearEvento, inicial);
  const [abierto, setAbierto] = useState(false);

  if (!abierto) {
    return evento ? (
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className="inline-flex h-10 items-center gap-2 rounded-lg border px-3 text-base font-medium transition-colors hover:bg-muted"
      >
        <Pencil className="h-4 w-4" />
        Editar
      </button>
    ) : (
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
    <section className="w-full space-y-4">
      <h2 className="text-base font-medium">{evento ? evento.titulo : "Nuevo evento"}</h2>

      <form action={accion} className="space-y-4">
        {evento && <input type="hidden" name="id" value={evento.id} />}
        <Hoja>
          <Seccion titulo="El evento" icono={Megaphone} columnas={1}>
            <Campo nombre="titulo" etiqueta="Título" requerido defecto={evento?.titulo} />
            <Campo nombre="resumen" etiqueta="Resumen" defecto={evento?.resumen ?? undefined} />
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
                defaultValue={evento?.descripcion ?? undefined}
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
              defecto={paraCampo(evento?.inicia ?? null)}
            />
            <Campo
              nombre="termina"
              etiqueta="Cuándo termina"
              tipo="datetime-local"
              defecto={paraCampo(evento?.termina ?? null)}
            />
            <div className="md:col-span-2">
              <Campo
                nombre="lugar"
                etiqueta="Dónde"
                placeholder="Casa Central, Aserradero u otra dirección"
                defecto={evento?.lugar ?? undefined}
              />
            </div>
          </Seccion>

          <Seccion titulo="Cupo y precio" icono={Ticket}>
            <Campo nombre="cupo" etiqueta="Cupo" tipo="number" defecto={String(evento?.cupo ?? 0)} />
            <Campo nombre="precio" etiqueta="Precio" defecto={String(evento?.precio ?? 0)} />
            <div className="md:col-span-2">
              <Interruptor
                nombre="soloProfesionales"
                etiqueta="Solo para profesionales aprobados"
                icono={HardHat}
                defecto={evento?.soloProfesionales}
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
            {evento ? "Guardar" : "Crear"}
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
