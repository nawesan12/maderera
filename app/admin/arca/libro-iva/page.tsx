import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Download } from "lucide-react";
import { EncabezadoPanel } from "@/components/admin/encabezado";
import { libroIvaVentas } from "@/lib/dal/admin/facturacion";
import { fechaCorta, formatearCuit, moneda } from "@/lib/formato";
import { leerPeriodoMensual } from "@/lib/periodos";
import { nombreComprobante, numeroFormateado } from "@/lib/fiscal/comprobantes";

export const metadata: Metadata = { title: "Libro IVA ventas" };

const MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

/**
 * Libro IVA ventas.
 *
 * Es lo que el contador pide todos los meses. Las notas de crédito aparecen en
 * negativo, así el total de cada columna es directamente lo que se declara, sin
 * tener que restar a mano.
 */
export default async function LibroIvaPage({
  searchParams,
}: {
  searchParams: Promise<{ periodo?: string }>;
}) {
  const { periodo } = await searchParams;

  const hoy = new Date();
  // La misma lectura que usa la exportación: estaba escrita dos veces con la
  // fórmula copiada, que es como una arregla un borde y la otra no.
  const { anio, mes, desde, hasta } = leerPeriodoMensual(periodo, hoy);

  const libro = await libroIvaVentas(desde, hasta);

  // Últimos doce meses para el selector.
  const periodos = Array.from({ length: 12 }, (_, i) => {
    const fecha = new Date(hoy.getFullYear(), hoy.getMonth() - i, 1);
    return {
      valor: `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, "0")}`,
      texto: `${MESES[fecha.getMonth()]} ${fecha.getFullYear()}`,
    };
  });

  const actual = `${anio}-${String(mes).padStart(2, "0")}`;

  return (
    <div className="space-y-5">
      <Link
        href="/admin/arca"
        className="inline-flex items-center gap-2 text-base text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-5 w-5" />
        Volver a ARCA
      </Link>

      <EncabezadoPanel
        titulo="Libro IVA ventas"
        detalle={`${MESES[mes - 1]} de ${anio} · las notas de crédito ya restan.`}
      >
        <a
          href={`/admin/arca/libro-iva/exportar?periodo=${actual}`}
          className="inline-flex h-10 items-center gap-2 rounded-lg border px-3.5 text-base font-medium transition-colors hover:bg-muted"
        >
          <Download className="h-5 w-5" />
          Exportar
        </a>
      </EncabezadoPanel>

      {/* Selector de período */}
      <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
        {periodos.map((p) => (
          <Link
            key={p.valor}
            href={`/admin/arca/libro-iva?periodo=${p.valor}`}
            className={`shrink-0 rounded-lg px-3 py-2 text-base transition-colors ${
              p.valor === actual
                ? "bg-brand-orange/12 font-medium text-brand-orange-dark"
                : "text-muted-foreground hover:bg-muted"
            }`}
          >
            {p.texto}
          </Link>
        ))}
      </div>

      {libro.filas.length === 0 ? (
        <section className="tarjeta px-6 py-14 text-center">
          <p className="text-base text-muted-foreground">
            No hay comprobantes emitidos en {MESES[mes - 1]} de {anio}.
          </p>
        </section>
      ) : (
        <div className="tarjeta overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[64rem] text-left">
              <thead>
                <tr className="border-b text-sm uppercase tracking-[0.06em] text-muted-foreground">
                  <th scope="col" className="px-4 py-3 font-semibold">Fecha</th>
                  <th scope="col" className="px-3 py-3 font-semibold">Comprobante</th>
                  <th scope="col" className="px-3 py-3 font-semibold">Cliente</th>
                  <th scope="col" className="px-3 py-3 font-semibold">CUIT</th>
                  <th scope="col" className="px-3 py-3 text-right font-semibold">Neto</th>
                  <th scope="col" className="px-3 py-3 text-right font-semibold">IVA 21%</th>
                  <th scope="col" className="px-3 py-3 text-right font-semibold">IVA 10,5%</th>
                  <th scope="col" className="px-3 py-3 text-right font-semibold">IVA 27%</th>
                  <th scope="col" className="px-3 py-3 text-right font-semibold">Exento</th>
                  <th scope="col" className="px-3 py-3 text-right font-semibold">Percep.</th>
                  <th scope="col" className="px-4 py-3 text-right font-semibold">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {libro.filas.map((fila) => (
                  <tr key={fila.id} className="hover:bg-muted/50">
                    <td className="tabular whitespace-nowrap px-4 py-3 text-base text-muted-foreground">
                      {fechaCorta.format(fila.fechaEmision)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3">
                      <Link
                        href={`/admin/facturacion/${fila.id}`}
                        className="block hover:text-brand-orange"
                      >
                        <span className="tabular block text-base">
                          {numeroFormateado(fila.puntoVenta, fila.numero)}
                        </span>
                        <span className="block text-sm text-muted-foreground">
                          {nombreComprobante(fila.tipo)}
                        </span>
                      </Link>
                    </td>
                    <td className="px-3 py-3 text-base">{fila.receptorNombre}</td>
                    <td className="tabular whitespace-nowrap px-3 py-3 text-base text-muted-foreground">
                      {formatearCuit(fila.receptorCuit)}
                    </td>
                    <Importe valor={fila.neto} />
                    <Importe valor={fila.iva21} />
                    <Importe valor={fila.iva105} />
                    <Importe valor={fila.iva27} />
                    <Importe valor={fila.exento} />
                    <Importe valor={fila.tributos} />
                    <td className="tabular whitespace-nowrap px-4 py-3 text-right text-base font-medium">
                      {moneda.format(fila.total)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 bg-muted/40 font-semibold">
                  <td colSpan={4} className="px-4 py-3.5 text-base">
                    Totales del período
                  </td>
                  <Importe valor={libro.totales.neto} destacado />
                  <Importe valor={libro.totales.iva21} destacado />
                  <Importe valor={libro.totales.iva105} destacado />
                  <Importe valor={libro.totales.iva27} destacado />
                  <Importe valor={libro.totales.exento} destacado />
                  <Importe valor={libro.totales.tributos} destacado />
                  <td className="tabular whitespace-nowrap px-4 py-3.5 text-right text-base">
                    {moneda.format(libro.totales.total)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      <p className="text-base text-muted-foreground">
        El IVA a declarar del período es{" "}
        <span className="tabular font-medium text-foreground">
          {moneda.format(
            libro.totales.iva21 + libro.totales.iva105 + libro.totales.iva27,
          )}
        </span>
        .
      </p>
    </div>
  );
}

function Importe({
  valor,
  destacado = false,
}: {
  valor: number;
  destacado?: boolean;
}) {
  return (
    <td
      className={`tabular whitespace-nowrap px-3 py-3 text-right text-base ${
        destacado ? "" : valor < 0 ? "text-green-700" : "text-muted-foreground"
      }`}
    >
      {valor === 0 ? "—" : moneda.format(valor)}
    </td>
  );
}
