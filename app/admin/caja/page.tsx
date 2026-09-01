import type { Metadata } from "next";
import Link from "next/link";
import { Banknote, Store } from "lucide-react";
import { requireStaff } from "@/lib/dal/session";
import { sucursalesConCaja, turnosCerrados } from "@/lib/mostrador/caja";
import { formatearMonto, haceCuanto } from "@/lib/formato";

export const metadata: Metadata = { title: "Caja" };

/**
 * Los cierres de caja del mostrador.
 *
 * Existe porque el arqueo sin historial no sirve de nada: la diferencia de un
 * día es un número; la de veinte días seguidos, siempre para el mismo lado y
 * con la misma persona, es otra cosa. Esto es lo que permite mirar la segunda.
 *
 * No se puede editar nada desde acá, a propósito. Un cierre es lo que se contó
 * ese día; corregirlo después con la calculadora en la mano es exactamente
 * cómo un descuadre deja de verse.
 */
export default async function CajaPage() {
  await requireStaff();

  const [sucursales, cerrados] = await Promise.all([
    sucursalesConCaja(),
    turnosCerrados(),
  ]);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-[26px] font-bold tracking-tight">Caja</h1>
        <p className="mt-1 text-base text-muted-foreground">
          Los turnos del mostrador, lo que debería haber y lo que se contó.
        </p>
      </header>

      <section className="grid gap-3 sm:grid-cols-2">
        {sucursales.map((s) => (
          <article key={s.id} className="tarjeta flex items-center gap-3.5 p-4">
            <span
              className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${
                s.turnoId
                  ? "estado-ok bg-[var(--estado-fondo)] text-[var(--estado-tinta)]"
                  : "bg-hundida text-muted-foreground"
              }`}
            >
              <Banknote className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-base font-semibold">{s.nombre}</p>
              <p className="text-sm text-muted-foreground">
                {s.turnoId && s.abiertaAt
                  ? `Abierta ${haceCuanto(new Date(s.abiertaAt))}`
                  : "Sin turno abierto"}
              </p>
            </div>
            <Link
              href="/mostrador"
              className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-lg border border-linea px-3.5 text-sm font-medium transition-colors hover:bg-hundida"
            >
              <Store className="h-4 w-4" />
              Ir al mostrador
            </Link>
          </article>
        ))}
      </section>

      <section className="tarjeta overflow-hidden">
        <header className="border-b border-linea px-5 py-3.5">
          <h2 className="text-base font-semibold">Turnos cerrados</h2>
        </header>

        {cerrados.length === 0 ? (
          <p className="px-5 py-10 text-center text-base text-muted-foreground">
            Todavía no se cerró ningún turno.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-base">
              <thead>
                <tr className="border-b border-linea text-left text-sm uppercase tracking-wide text-muted-foreground">
                  <th className="px-5 py-2.5 font-semibold">Sucursal</th>
                  <th className="px-5 py-2.5 font-semibold">Quién</th>
                  <th className="px-5 py-2.5 font-semibold">Cerrado</th>
                  <th className="px-5 py-2.5 text-right font-semibold">Esperado</th>
                  <th className="px-5 py-2.5 text-right font-semibold">Contado</th>
                  <th className="px-5 py-2.5 text-right font-semibold">Diferencia</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-linea">
                {cerrados.map((t) => {
                  const esperado = Number(t.esperado);
                  const contado = t.contado === null ? null : Number(t.contado);
                  const diferencia = contado === null ? null : contado - esperado;
                  const cuadra = diferencia !== null && Math.abs(diferencia) < 0.01;

                  return (
                    <tr key={t.id}>
                      <td className="px-5 py-3">{t.sucursal}</td>
                      <td className="px-5 py-3 text-muted-foreground">{t.abiertaPor}</td>
                      <td className="px-5 py-3 text-muted-foreground">
                        {t.cerradaAt ? haceCuanto(new Date(t.cerradaAt)) : "—"}
                      </td>
                      <td className="tabular px-5 py-3 text-right">
                        {formatearMonto(esperado)}
                      </td>
                      <td className="tabular px-5 py-3 text-right">
                        {formatearMonto(contado)}
                      </td>
                      <td className="px-5 py-3 text-right">
                        {/* Los mismos tokens de signo que usa la cuenta
                            corriente y el cierre del mostrador: falta en rojo,
                            sobra en verde, cuadra en gris. Que un descuadre se
                            vea igual en las dos pantallas es lo que hace que el
                            color signifique algo. */}
                        <span
                          className={`tabular font-semibold ${
                            diferencia === null
                              ? "text-muted-foreground"
                              : cuadra
                                ? "text-saldo-cero"
                                : diferencia < 0
                                  ? "text-saldo-debe"
                                  : "text-saldo-favor"
                          }`}
                        >
                          {diferencia === null ? "—" : formatearMonto(diferencia)}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
