"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { CalendarRange } from "lucide-react";
import { PERIODOS, PERIODO_POR_OMISION, type ClavePeriodo } from "@/lib/periodos";

/**
 * Selector de período.
 *
 * Va en la URL y no en estado local, como el resto de los filtros del sistema:
 * así la pantalla se puede compartir y "las ventas de este año" es un enlace
 * que le llega igual a la otra persona.
 *
 * El valor por omisión no se escribe en la URL. Una dirección limpia es la del
 * caso normal.
 */
export function FiltroPeriodo({ actual }: { actual: ClavePeriodo }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pendiente, iniciar] = useTransition();

  function elegir(clave: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (clave === PERIODO_POR_OMISION) params.delete("periodo");
    else params.set("periodo", clave);

    iniciar(() =>
      router.replace(params.size > 0 ? `?${params}` : "?", { scroll: false }),
    );
  }

  return (
    <label className="flex items-center gap-2">
      <span className="sr-only">Período</span>
      <span className="relative flex items-center">
        <CalendarRange className="pointer-events-none absolute left-3 h-[18px] w-[18px] text-texto-3" />
        <select
          value={actual}
          onChange={(e) => elegir(e.target.value)}
          aria-busy={pendiente}
          className="h-10 appearance-none rounded-lg border border-linea bg-card pl-10 pr-9 text-[15px] outline-none transition-colors focus:border-accion/50"
        >
          {PERIODOS.map((p) => (
            <option key={p.clave} value={p.clave}>
              {p.etiqueta}
            </option>
          ))}
        </select>
        <span
          className="pointer-events-none absolute right-3 text-xs text-texto-3"
          aria-hidden="true"
        >
          ▾
        </span>
      </span>
    </label>
  );
}
