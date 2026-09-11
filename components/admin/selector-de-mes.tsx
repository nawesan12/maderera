"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";

/**
 * Elegir el mes de una pantalla que trabaja por mes cerrado.
 *
 * No es lo mismo que `FiltroPeriodo`: ese ofrece "este mes / este año / los
 * últimos doce", y sirve para mirar tendencias. Acá el mes es una unidad
 * contable —el IVA de septiembre, los gastos de septiembre, las retenciones de
 * septiembre—, y hay que poder ir a uno cualquiera, incluido el de hace dos
 * años cuando llama el contador.
 *
 * Existía como `<input type="month">` suelto dentro de un `<form>` en el libro
 * de IVA. En Gastos y en Retenciones **no existía en absoluto**: las páginas
 * leían el mes del URL, lo escribían en el encabezado y no daban forma de
 * cambiarlo. El único modo era teclear la dirección a mano, lo que en la
 * práctica significa que nadie miraba otro mes que el corriente.
 *
 * Cambia al elegir, sin botón: un selector de mes no necesita confirmarse.
 */
export function SelectorDeMes({
  actual,
  etiqueta = "Mes",
}: {
  /** En formato `YYYY-MM`, el mismo que devuelve `leerPeriodoMensual`. */
  actual: string;
  etiqueta?: string;
}) {
  const router = useRouter();
  const parametros = useSearchParams();
  const [pendiente, iniciar] = useTransition();

  function elegir(valor: string) {
    if (!valor) return;
    const params = new URLSearchParams(parametros.toString());
    params.set("periodo", valor);
    iniciar(() => router.replace(`?${params}`, { scroll: false }));
  }

  return (
    <label className="flex items-center gap-2">
      <span className="sr-only">{etiqueta}</span>
      <input
        type="month"
        value={actual}
        onChange={(e) => elegir(e.target.value)}
        aria-busy={pendiente}
        className="tabular h-11 rounded-lg border border-linea bg-card px-3 text-base outline-none transition-colors focus:border-accion/50"
      />
    </label>
  );
}
