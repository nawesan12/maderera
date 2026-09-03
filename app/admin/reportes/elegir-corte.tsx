"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { CORTES, type CorteDelReporte } from "@/lib/reportes-cortes";

/**
 * Por dónde cortar el reporte.
 *
 * Va en la URL igual que el período: así "las ventas por vendedor de este año"
 * es un enlace que se manda por WhatsApp y le abre lo mismo al otro.
 */
export function ElegirCorte({ actual }: { actual: CorteDelReporte }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pendiente, iniciar] = useTransition();

  function elegir(clave: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (clave === "producto") params.delete("corte");
    else params.set("corte", clave);

    iniciar(() =>
      router.replace(params.size > 0 ? `?${params}` : "?", { scroll: false }),
    );
  }

  return (
    <div
      className={`flex flex-wrap gap-1.5 ${pendiente ? "opacity-60" : ""}`}
      role="group"
      aria-label="Cómo agrupar"
    >
      {CORTES.map((c) => (
        <button
          key={c.clave}
          type="button"
          onClick={() => elegir(c.clave)}
          aria-pressed={actual === c.clave}
          className={`h-9 rounded-lg px-3.5 text-base font-medium transition-colors ${
            actual === c.clave
              ? "bg-primary text-primary-foreground"
              : "border hover:bg-muted"
          }`}
        >
          {c.etiqueta}
        </button>
      ))}
    </div>
  );
}
