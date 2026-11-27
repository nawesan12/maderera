import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, FileCheck2 } from "lucide-react";
import { SelectorDeMes } from "@/components/admin/selector-de-mes";
import { requireStaffRole } from "@/lib/dal/session";
import {
  creditoPorRetenciones,
  listarRetencionesSufridas,
} from "@/lib/dal/admin/retenciones-sufridas";
import { leerPeriodoMensual } from "@/lib/periodos";
import { fechaCorta, formatearMonto } from "@/lib/formato";
import { todosLosRegimenes } from "@/lib/dal/admin/pagos-proveedor";
import { CargarSufrida } from "./cargar";
import { Regimenes } from "./regimenes";
import { Vacio } from "@/components/admin/vacio";
import { AnularRecibo } from "@/components/cobros/anular-recibo";

export const metadata: Metadata = { title: "Retenciones" };

const IMPUESTOS: Record<string, string> = {
  ganancias: "Ganancias",
  iva: "IVA",
  suss: "SUSS",
  iibb: "Ingresos Brutos",
};

/**
 * Las retenciones que nos practicaron.
 *
 * El crédito se separa por impuesto y no se suma en un total: la retención de
 * Ganancias no se puede aplicar contra el IVA, y un número solo invitaría a
 * usarlo como si se pudiera.
 */
export default async function RetencionesSufridasPage({
  searchParams,
}: {
  searchParams: Promise<{ periodo?: string }>;
}) {
  await requireStaffRole("admin");

  const { periodo: crudo } = await searchParams;
  const periodo = leerPeriodoMensual(crudo, new Date());

  const [sufridas, credito, regimenes] = await Promise.all([
    listarRetencionesSufridas(),
    creditoPorRetenciones(periodo.desde, periodo.hasta),
    // Con qué se retiene. Va en esta misma pantalla porque es la única que
    // habla de retenciones, y hasta ahora las alícuotas solo se podían cambiar
    // entrando a la base.
    todosLosRegimenes(),
  ]);

  const etiqueta = new Date(periodo.anio, periodo.mes - 1, 1).toLocaleDateString(
    "es-AR",
    { month: "long", year: "numeric" },
  );

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={`/admin/arca?periodo=${periodo.clave}`}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          ARCA
        </Link>
        <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-[26px] font-bold tracking-tight">
              Retenciones
            </h1>
            {/* Los certificados que entregan los clientes: bajan lo que deben y se computan como crédito contra el impuesto. */}
          </div>
          {/* El mes se leía del URL y se escribía en las tarjetas de crédito,
              pero no había con qué cambiarlo: para ver el mes anterior había
              que teclear la dirección. */}
          <SelectorDeMes actual={periodo.clave} />
        </div>
      </div>

      {credito.length > 0 && (
        <section className="grid gap-3 sm:grid-cols-3">
          {credito.map((c) => (
            <article key={c.impuesto} className="tarjeta p-4">
              <p className="text-sm text-muted-foreground">
                Crédito de {IMPUESTOS[c.impuesto] ?? c.impuesto} · {etiqueta}
              </p>
              <p className="tabular mt-0.5 text-2xl font-bold">
                {formatearMonto(Number(c.total))}
              </p>
              <p className="text-sm text-muted-foreground">
                {c.cantidad} certificado{Number(c.cantidad) > 1 ? "s" : ""}
              </p>
            </article>
          ))}
        </section>
      )}

      <CargarSufrida />

      <section className="tarjeta overflow-hidden">
        {sufridas.length === 0 ? (
          <Vacio
            icono={FileCheck2}
            titulo="Todavía no se cargó ningún certificado"
          />
        ) : (
          // Sin ancho mínimo: debajo de 640 px la tabla se apila sola
          // (tablas-apilables), en vez de correrse de costado.
          <table className="w-full text-base">
            <thead>
              <tr className="border-b border-linea text-left text-sm uppercase tracking-wide text-muted-foreground">
                <th className="px-5 py-2.5 font-semibold">Fecha</th>
                <th className="px-5 py-2.5 font-semibold">Certificado</th>
                <th className="px-5 py-2.5 font-semibold">Cliente</th>
                <th className="px-5 py-2.5 font-semibold">Impuesto</th>
                <th className="px-5 py-2.5 text-right font-semibold">Base</th>
                <th className="px-5 py-2.5 text-right font-semibold">Retenido</th>
                <th className="px-5 py-2.5">
                  <span className="sr-only">Anular</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-linea">
              {sufridas.map((r) => (
                <tr key={r.id}>
                  <td className="tabular px-5 py-3 text-muted-foreground">
                    {fechaCorta.format(r.fecha)}
                  </td>
                  <td className="codigo px-5 py-3">{r.numero}</td>
                  <td className="px-5 py-3">
                    <Link href={`/admin/clientes/${r.customerId}`} className="hover:underline">
                      {r.cliente}
                    </Link>
                  </td>
                  <td className="px-5 py-3 text-muted-foreground">
                    {IMPUESTOS[r.impuesto] ?? r.impuesto}
                    {r.codigoRegimen && ` · ${r.codigoRegimen}`}
                  </td>
                  <td className="tabular px-5 py-3 text-right text-muted-foreground">
                    {formatearMonto(Number(r.base))}
                  </td>
                  <td className="tabular px-5 py-3 text-right font-semibold">
                    {formatearMonto(Number(r.importe))}
                  </td>
                  {/* Mal cargado se corrige acá: se anula su recibo (con el
                      PIN, como en la ficha) y se vuelve a cargar. Había que
                      buscar el recibo en la ficha del cliente (M3S1-027). */}
                  <td className="px-5 py-3 text-right">
                    {r.reciboId && r.recibo && (
                      <AnularRecibo id={r.reciboId} numero={r.recibo} importe={Number(r.importe)} cliente={r.cliente} />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* Con qué se retiene, plegado y al final: se configura una vez y se
          mira cuando algo no cuadra. Arriba tapaba la carga del día (a 375
          px eran 2.000 px de configuración antes del certificado, M2S1-041). */}
      <Regimenes
        regimenes={regimenes.map((r) => ({
          id: r.id,
          codigo: r.codigo,
          nombre: r.nombre,
          impuesto: r.impuesto,
          jurisdiccion: r.jurisdiccion,
          alicuota: Number(r.alicuota),
          alicuotaNoInscripto: Number(r.alicuotaNoInscripto),
          minimoNoImponible: Number(r.minimoNoImponible),
          minimoRetencion: Number(r.minimoRetencion),
          activo: r.activo,
        }))}
      />
    </div>
  );
}
