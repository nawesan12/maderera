"use client";

import { useState } from "react";
import { useActionState } from "react";
import { ChevronDown, Loader2, Pencil } from "lucide-react";
import { guardarSucursal, type EstadoSucursal } from "./actions";
import type { SucursalConMetricas } from "@/lib/dal/admin/sucursales";

const inicial: EstadoSucursal = {};

/**
 * La ficha, plegada.
 *
 * Se abre solo cuando hay algo que corregir: los datos de una sucursal cambian
 * dos veces por año, y un formulario permanentemente desplegado empujaría los
 * números del día —que es lo que se viene a mirar— fuera de la pantalla.
 */
export function EditorDeSucursal({ sucursal }: { sucursal: SucursalConMetricas }) {
  const [abierto, setAbierto] = useState(false);
  const [estado, guardar, guardando] = useActionState(guardarSucursal, inicial);

  return (
    <div>
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        aria-expanded={abierto}
        className="inline-flex h-10 items-center gap-2 rounded-lg border px-3.5 text-base font-medium transition-colors hover:bg-muted"
      >
        <Pencil className="h-4 w-4" />
        Editar la ficha publicada
        <ChevronDown
          className={`h-4 w-4 transition-transform ${abierto ? "rotate-180" : ""}`}
        />
      </button>

      {abierto && (
        <form action={guardar} className="mt-4 space-y-4">
          <input type="hidden" name="id" value={sucursal.id} />

          <div className="grid gap-4 sm:grid-cols-2">
            <Campo
              nombre="nombre"
              etiqueta="Nombre"
              valorInicial={sucursal.nombre}
              requerido
            />
            <Campo
              nombre="direccion"
              etiqueta="Dirección"
              valorInicial={sucursal.direccion}
              placeholder="Av. Juan B. Justo 4153"
            />
            <Campo
              nombre="telefono"
              etiqueta="Teléfono"
              valorInicial={sucursal.telefono ?? ""}
              placeholder="(0223) 474-3328"
            />
            <Campo
              nombre="whatsapp"
              etiqueta="WhatsApp"
              valorInicial={sucursal.whatsapp ?? ""}
              placeholder="5492234743328"
              ayuda="Con código de país y sin espacios: así lo necesita el enlace de chat."
            />
            <Campo
              nombre="email"
              etiqueta="Correo"
              tipo="email"
              valorInicial={sucursal.email ?? ""}
            />
            <Campo
              nombre="horario"
              etiqueta="Horario"
              valorInicial={sucursal.horario ?? ""}
              placeholder="Lun a Vie 8 a 16 h · Sáb 8 a 12 h"
            />
          </div>

          <Campo
            nombre="mapUrl"
            etiqueta="Enlace del mapa"
            valorInicial={sucursal.mapUrl ?? ""}
            placeholder="https://maps.google.com/..."
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <Area
              nombre="servicios"
              etiqueta="Servicios"
              valorInicial={sucursal.servicios}
              ayuda="Uno por renglón. Se publican como lista en la página de sucursales."
              placeholder={"Corte a medida\nEntrega en el día\nAsesoramiento técnico"}
            />
            <Area
              nombre="destacados"
              etiqueta="Destacados"
              valorInicial={sucursal.destacados}
              ayuda="Uno por renglón, dos o tres palabras cada uno."
              placeholder={"Depósito propio\nEstacionamiento"}
            />
          </div>

          <label className="flex items-center gap-2.5 text-base">
            <input
              type="checkbox"
              name="active"
              defaultChecked={sucursal.active}
              className="h-4 w-4 accent-brand-orange"
            />
            Se muestra en el sitio público
          </label>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={guardando}
              className="inline-flex h-10 items-center gap-2 rounded-lg bg-brand-orange px-4 text-base font-medium text-white transition-colors hover:bg-brand-orange-dark disabled:opacity-60"
            >
              {guardando && <Loader2 className="h-4 w-4 animate-spin" />}
              Guardar
            </button>

            {estado.error && (
              <p className="text-base text-destructive">{estado.error}</p>
            )}
            {estado.ok && (
              <p className="text-base text-muted-foreground">{estado.ok}</p>
            )}
          </div>
        </form>
      )}
    </div>
  );
}

function Campo({
  nombre,
  etiqueta,
  valorInicial,
  placeholder,
  ayuda,
  tipo = "text",
  requerido = false,
}: {
  nombre: string;
  etiqueta: string;
  valorInicial: string;
  placeholder?: string;
  ayuda?: string;
  tipo?: string;
  requerido?: boolean;
}) {
  const id = `${nombre}-campo`;

  return (
    <div>
      <label htmlFor={id} className="block text-base font-medium">
        {etiqueta}
      </label>
      <input
        id={id}
        name={nombre}
        type={tipo}
        required={requerido}
        defaultValue={valorInicial}
        placeholder={placeholder}
        className="mt-1 h-10 w-full rounded-lg border bg-background px-3 text-base"
      />
      {ayuda && <p className="mt-1 text-sm text-muted-foreground">{ayuda}</p>}
    </div>
  );
}

function Area({
  nombre,
  etiqueta,
  valorInicial,
  placeholder,
  ayuda,
}: {
  nombre: string;
  etiqueta: string;
  valorInicial: string;
  placeholder?: string;
  ayuda?: string;
}) {
  const id = `${nombre}-campo`;

  return (
    <div>
      <label htmlFor={id} className="block text-base font-medium">
        {etiqueta}
      </label>
      <textarea
        id={id}
        name={nombre}
        rows={4}
        defaultValue={valorInicial}
        placeholder={placeholder}
        className="mt-1 w-full rounded-lg border bg-background px-3 py-2 text-base"
      />
      {ayuda && <p className="mt-1 text-sm text-muted-foreground">{ayuda}</p>}
    </div>
  );
}
