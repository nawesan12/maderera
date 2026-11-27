"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

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
const NOMBRE_DEL_MES = new Intl.DateTimeFormat("es-AR", { month: "long", year: "numeric", timeZone: "UTC" });

/** «2026-11» → «noviembre de 2026». */
export function nombreDelMes(clave: string): string {
  const [a, m] = clave.split("-").map(Number);
  return NOMBRE_DEL_MES.format(new Date(Date.UTC(a, m - 1, 1)));
}

/** El mes `delta` meses antes o después de `clave` («2026-11», −1 → «2026-10»). */
export function mesCorrido(clave: string, delta: number): string {
  const [a, m] = clave.split("-").map(Number);
  const d = new Date(Date.UTC(a, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * Los meses que ofrece el selector: los tres años hasta el corriente, más el
 * elegido si está fuera de ese rango (una dirección vieja tecleada a mano).
 */
function mesesParaElegir(actual: string, hoy: string, desde?: string): string[] {
  // Con `desde` (el primer mes con datos), la lista arranca ahí: treinta y
  // seis meses vacíos no le sirven a nadie (mes simulado, M3S4-035).
  const meses = Array.from({ length: 36 }, (_, i) => mesCorrido(hoy, -i)).filter((m) => !desde || m >= desde);
  if (meses.length === 0) meses.push(hoy);
  if (!meses.includes(actual)) meses.push(actual);
  return meses.sort().reverse();
}

/**
 * El mes en castellano y con flechas a los costados. Era un `<input
 * type="month">` y el navegador lo dibujaba en el idioma del sistema:
 * «November 2026» en una pantalla en castellano (mes simulado, H171).
 */
export function SelectorDeMes({
  actual,
  etiqueta = "Mes",
  desde,
}: {
  /** En formato `YYYY-MM`, el mismo que devuelve `leerPeriodoMensual`. */
  actual: string;
  etiqueta?: string;
  /** El primer mes que se ofrece (`YYYY-MM`): el primero con datos. */
  desde?: string;
}) {
  const router = useRouter();
  const parametros = useSearchParams();
  const [pendiente, iniciar] = useTransition();
  // El mes corriente en Argentina: la lista no ofrece meses que no llegaron.
  const hoy = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires", year: "numeric", month: "2-digit" })
    .format(new Date())
    .slice(0, 7);
  const siguiente = mesCorrido(actual, 1);

  function elegir(valor: string) {
    if (!valor) return;
    const params = new URLSearchParams(parametros.toString());
    params.set("periodo", valor);
    // Cambiar de mes vuelve a la primera página de lo que se pagine.
    params.delete("pagina");
    iniciar(() => router.replace(`?${params}`, { scroll: false }));
  }

  const flecha =
    "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-hundida hover:text-foreground disabled:opacity-30";

  return (
    <div className="flex items-center gap-1" role="group" aria-label={etiqueta} aria-busy={pendiente}>
      <button
        type="button"
        onClick={() => elegir(mesCorrido(actual, -1))}
        disabled={Boolean(desde) && mesCorrido(actual, -1) < (desde ?? "")}
        aria-label="Mes anterior"
        className={flecha}
      >
        <ChevronLeft className="h-5 w-5" />
      </button>
      <label>
        <span className="sr-only">{etiqueta}</span>
        <select
          value={actual}
          onChange={(e) => elegir(e.target.value)}
          className="h-11 rounded-lg border border-linea bg-card px-3 text-base outline-none transition-colors focus:border-accion/50"
        >
          {mesesParaElegir(actual, hoy, desde).map((m) => (
            <option key={m} value={m}>
              {nombreDelMes(m)}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        onClick={() => elegir(siguiente)}
        disabled={siguiente > hoy}
        aria-label="Mes siguiente"
        className={flecha}
      >
        <ChevronRight className="h-5 w-5" />
      </button>
    </div>
  );
}
