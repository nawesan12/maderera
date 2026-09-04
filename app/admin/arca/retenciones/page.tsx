import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, FileCheck2 } from "lucide-react";
import { requireStaffRole } from "@/lib/dal/session";
import {
  creditoPorRetenciones,
  listarRetencionesSufridas,
} from "@/lib/dal/admin/retenciones-sufridas";
import { listarClientes } from "@/lib/dal/admin/clientes";
import { leerPeriodoMensual } from "@/lib/periodos";
import { formatearMonto } from "@/lib/formato";
import { CargarSufrida } from "./cargar";

export const metadata: Metadata = { title: "Retenciones sufridas" };

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

  const [sufridas, credito, clientes] = await Promise.all([
    listarRetencionesSufridas(),
    creditoPorRetenciones(periodo.desde, periodo.hasta),
    listarClientes({}),
  ]);

  const etiqueta = new Date(periodo.anio, periodo.mes - 1, 1).toLocaleDateString(
    "es-AR",
    { month: "long", year: "numeric" },
  );

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/admin/arca"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          ARCA
        </Link>
        <h1 className="mt-2 text-[26px] font-bold tracking-tight">
          Retenciones sufridas
        </h1>
        <p className="mt-1 text-base text-muted-foreground">
          Los certificados que nos entregan los clientes. Bajan lo que deben y
          se computan como crédito contra el impuesto.
        </p>
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

      <CargarSufrida
        clientes={clientes.map((c) => ({
          id: c.id,
          nombre: c.razonSocial ?? c.nombre,
          cuit: c.cuit,
        }))}
      />

      <section className="tarjeta overflow-hidden">
        {sufridas.length === 0 ? (
          <div className="px-5 py-14 text-center">
            <FileCheck2 className="mx-auto h-8 w-8 text-muted-foreground" />
            <p className="mt-3 text-base text-muted-foreground">
              Todavía no se cargó ningún certificado.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-base">
              <thead>
                <tr className="border-b border-linea text-left text-sm uppercase tracking-wide text-muted-foreground">
                  <th className="px-5 py-2.5 font-semibold">Fecha</th>
                  <th className="px-5 py-2.5 font-semibold">Certificado</th>
                  <th className="px-5 py-2.5 font-semibold">Cliente</th>
                  <th className="px-5 py-2.5 font-semibold">Impuesto</th>
                  <th className="px-5 py-2.5 text-right font-semibold">Base</th>
                  <th className="px-5 py-2.5 text-right font-semibold">
                    Retenido
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-linea">
                {sufridas.map((r) => (
                  <tr key={r.id}>
                    <td className="tabular px-5 py-3 text-muted-foreground">
                      {r.fecha.toLocaleDateString("es-AR")}
                    </td>
                    <td className="tabular px-5 py-3">{r.numero}</td>
                    <td className="px-5 py-3">
                      <Link
                        href={`/admin/clientes/${r.customerId}`}
                        className="hover:underline"
                      >
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
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
