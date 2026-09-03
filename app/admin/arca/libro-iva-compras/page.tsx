import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Download } from "lucide-react";
import { requireStaffRole } from "@/lib/dal/session";
import { libroIvaCompras } from "@/lib/dal/admin/compras-fiscal";
import { leerPeriodoMensual } from "@/lib/periodos";
import {
  daCreditoFiscal,
  nombreComprobanteCompra,
  numeroDeCompra,
} from "@/lib/fiscal/comprobantes-compra";

export const metadata: Metadata = { title: "Libro IVA compras" };

const moneda = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
});

/**
 * El libro IVA compras.
 *
 * Espejo del de ventas, con una diferencia que gobierna la lectura: allá el IVA
 * es débito —lo que hay que depositar— y acá es crédito —lo que se descuenta—.
 * La posición del mes es la resta de los dos.
 *
 * La columna de crédito computable no es decorativa: **la B y la C no
 * discriminan IVA y no dan crédito**, aunque tengan un importe cargado.
 * Sumarlas al crédito del mes es el error que más caro sale de todo el libro.
 */
export default async function LibroIvaComprasPage({
  searchParams,
}: {
  searchParams: Promise<{ periodo?: string }>;
}) {
  await requireStaffRole("admin");

  const { periodo: crudo } = await searchParams;
  const periodo = leerPeriodoMensual(crudo, new Date());
  const etiqueta = new Date(periodo.anio, periodo.mes - 1, 1).toLocaleDateString(
    "es-AR",
    { month: "long", year: "numeric" },
  );

  const libro = await libroIvaCompras(periodo.desde, periodo.hasta);

  const computable = libro.filas
    .filter((f) => daCreditoFiscal(f.tipo))
    .reduce((s, f) => s + f.iva21 + f.iva105 + f.iva27, 0);

  const total = libro.totales.iva21 + libro.totales.iva105 + libro.totales.iva27;

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

        <header className="mt-2 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-[26px] font-bold tracking-tight">
              Libro IVA compras
            </h1>
            <p className="mt-1 text-base text-muted-foreground">
              {etiqueta} · {libro.filas.length} comprobantes
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <form className="flex gap-2">
              <input
                type="month"
                name="periodo"
                defaultValue={periodo.clave}
                className="tabular h-11 rounded-lg border border-linea bg-card px-3 text-base"
              />
              <button className="h-11 rounded-lg border border-linea px-4 text-base font-medium">
                Ver
              </button>
            </form>

            <a
              href={`/admin/arca/libro-iva-compras/exportar?periodo=${periodo.clave}`}
              className="inline-flex h-11 items-center gap-1.5 rounded-lg border border-linea px-4 text-base font-medium hover:bg-hundida"
            >
              <Download className="h-4 w-4" />
              CSV
            </a>
          </div>
        </header>
      </div>

      <section className="grid gap-3 sm:grid-cols-3">
        <article className="tarjeta p-4">
          <p className="text-sm text-muted-foreground">Neto de compras</p>
          <p className="tabular mt-0.5 text-2xl font-bold">
            {moneda.format(libro.totales.neto)}
          </p>
        </article>
        <article className="tarjeta p-4">
          <p className="text-sm text-muted-foreground">IVA crédito computable</p>
          <p className="tabular mt-0.5 text-2xl font-bold">
            {moneda.format(computable)}
          </p>
          {Math.abs(total - computable) >= 0.01 && (
            <p className="mt-1 text-sm text-muted-foreground">
              {moneda.format(total - computable)} en comprobantes que no
              discriminan IVA: no se computa.
            </p>
          )}
        </article>
        <article className="tarjeta p-4">
          <p className="text-sm text-muted-foreground">Percepciones sufridas</p>
          <p className="tabular mt-0.5 text-2xl font-bold">
            {moneda.format(libro.totales.percepciones)}
          </p>
        </article>
      </section>

      {libro.filas.length === 0 ? (
        <p className="tarjeta px-5 py-14 text-center text-base text-muted-foreground">
          No hay comprobantes de compra cargados en {etiqueta}.
        </p>
      ) : (
        <div className="tarjeta overflow-x-auto">
          <table className="w-full min-w-[980px] text-base">
            <thead>
              <tr className="border-b border-linea text-left text-sm uppercase tracking-wide text-muted-foreground">
                <th className="px-3 py-3 font-semibold">Fecha</th>
                <th className="px-3 py-3 font-semibold">Comprobante</th>
                <th className="px-3 py-3 font-semibold">Proveedor</th>
                <th className="px-3 py-3 font-semibold">CUIT</th>
                <th className="px-3 py-3 text-right font-semibold">Neto</th>
                <th className="px-3 py-3 text-right font-semibold">IVA 21%</th>
                <th className="px-3 py-3 text-right font-semibold">IVA 10,5%</th>
                <th className="px-3 py-3 text-right font-semibold">IVA 27%</th>
                <th className="px-3 py-3 text-right font-semibold">Percep.</th>
                <th className="px-3 py-3 text-right font-semibold">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-linea">
              {libro.filas.map((f) => (
                <tr key={f.id}>
                  <td className="tabular whitespace-nowrap px-3 py-3 text-muted-foreground">
                    {f.fechaEmision.toLocaleDateString("es-AR")}
                  </td>
                  <td className="px-3 py-3">
                    <span className="tabular block">
                      {numeroDeCompra(f.puntoVenta, f.numero)}
                    </span>
                    <span className="block text-sm text-muted-foreground">
                      {nombreComprobanteCompra(f.tipo)}
                      {!daCreditoFiscal(f.tipo) && " · sin crédito fiscal"}
                    </span>
                  </td>
                  <td className="px-3 py-3">{f.proveedor}</td>
                  <td className="tabular px-3 py-3 text-muted-foreground">
                    {f.cuit ?? "—"}
                  </td>
                  <Importe valor={f.neto} />
                  <Importe valor={f.iva21} />
                  <Importe valor={f.iva105} />
                  <Importe valor={f.iva27} />
                  <Importe valor={f.percepciones} />
                  <td className="tabular whitespace-nowrap px-3 py-3 text-right font-medium">
                    {moneda.format(f.total)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-linea bg-hundida font-semibold">
                <td colSpan={4} className="px-3 py-3.5">
                  Totales del período
                </td>
                <Importe valor={libro.totales.neto} />
                <Importe valor={libro.totales.iva21} />
                <Importe valor={libro.totales.iva105} />
                <Importe valor={libro.totales.iva27} />
                <Importe valor={libro.totales.percepciones} />
                <td className="tabular whitespace-nowrap px-3 py-3.5 text-right">
                  {moneda.format(libro.totales.total)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

function Importe({ valor }: { valor: number }) {
  return (
    <td className="tabular whitespace-nowrap px-3 py-3 text-right">
      {valor === 0 ? (
        <span className="text-muted-foreground">—</span>
      ) : (
        moneda.format(valor)
      )}
    </td>
  );
}
