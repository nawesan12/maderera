"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { CalendarRange, X } from "lucide-react";

/**
 * Un rango de fechas libre, además de los períodos armados.
 *
 * Los presets —este mes, últimos 90 días— no contestan la pregunta que se hace
 * todos los días en el mostrador: **«¿cuánto facturamos el sábado?»**. Esto sí:
 * una fecha sola es ese día, y dos son el tramo.
 *
 * Mientras hay un rango puesto, el selector de período no manda: se dice en
 * pantalla, porque dos filtros de fecha discutiendo en silencio es cómo alguien
 * termina mirando otro mes sin darse cuenta.
 */
export function FiltroRango({
  desde,
  hasta,
}: {
  desde?: string;
  hasta?: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pendiente, iniciar] = useTransition();

  function cambiar(cambios: Record<string, string>) {
    const params = new URLSearchParams(searchParams.toString());

    for (const [clave, valor] of Object.entries(cambios)) {
      if (valor) params.set(clave, valor);
      else params.delete(clave);
    }

    iniciar(() =>
      router.replace(params.size > 0 ? `?${params}` : "?", { scroll: false }),
    );
  }

  const hayRango = Boolean(desde || hasta);

  return (
    <div className="flex flex-wrap items-center gap-1.5" aria-busy={pendiente}>
      <CalendarRange className="h-[18px] w-[18px] text-texto-3" aria-hidden />
      <label className="flex items-center gap-1.5">
        <span className="sr-only">Desde</span>
        <input
          type="date"
          value={desde ?? ""}
          onChange={(e) => cambiar({ desde: e.target.value })}
          className="h-10 rounded-lg border border-linea bg-card px-2.5 text-[15px] outline-none transition-colors focus:border-accion/50"
        />
      </label>
      <span className="text-sm text-texto-3">a</span>
      <label className="flex items-center gap-1.5">
        <span className="sr-only">Hasta</span>
        <input
          type="date"
          value={hasta ?? ""}
          onChange={(e) => cambiar({ hasta: e.target.value })}
          className="h-10 rounded-lg border border-linea bg-card px-2.5 text-[15px] outline-none transition-colors focus:border-accion/50"
        />
      </label>

      {hayRango && (
        <button
          type="button"
          onClick={() => cambiar({ desde: "", hasta: "" })}
          className="inline-flex h-10 items-center gap-1 rounded-lg border border-linea px-2.5 text-sm text-texto-2 transition-colors hover:bg-hundida"
        >
          <X className="h-4 w-4" />
          Quitar fechas
        </button>
      )}
    </div>
  );
}
