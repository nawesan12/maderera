import type { Metadata } from "next";
import Link from "next/link";
import { FileText } from "lucide-react";
import { requireStaffRole } from "@/lib/dal/session";
import { listarFacturasDeCompra } from "@/lib/dal/admin/compras-fiscal";
import { proveedoresParaElegir } from "@/lib/dal/admin/proveedores";
import { formatearMonto } from "@/lib/formato";
import {
  nombreComprobanteCompra,
  numeroDeCompra,
} from "@/lib/fiscal/comprobantes-compra";
import { EncabezadoPanel } from "@/components/admin/encabezado";
import { Vacio } from "@/components/admin/vacio";
import { CargarFactura } from "./cargar";
import { FiltroDePago } from "./filtro";

export const metadata: Metadata = { title: "Facturas de compra" };

/**
 * Los comprobantes que recibimos.
 *
 * Es la capa fiscal de las compras y va aparte de las recepciones a propósito:
 * la recepción dice qué entró al depósito, la factura dice qué crédito fiscal
 * se puede computar. Llegan por caminos distintos y a veces una factura cubre
 * tres remitos.
 */
export default async function FacturasDeCompraPage({
  searchParams,
}: {
  searchParams: Promise<{ pago?: string }>;
}) {
  await requireStaffRole("admin");

  const { pago = "todas" } = await searchParams;

  const [todas, proveedores] = await Promise.all([
    listarFacturasDeCompra(),
    proveedoresParaElegir(),
  ]);

  /*
   * El filtro se aplica acá y no en la consulta a propósito: "pagada" no es una
   * columna sino la comparación entre el total y lo imputado en pagos, que la
   * consulta ya trae. Repetir esa resta en SQL sería tener la misma regla
   * escrita en dos lugares, que es de donde salen las contradicciones entre lo
   * que dice una pantalla y lo que dice la otra.
   */
  const saldo = (f: (typeof todas)[number]) =>
    Number(f.total) - Number(f.pagado);

  const facturas =
    pago === "pendiente"
      ? todas.filter((f) => saldo(f) > 0.01)
      : pago === "pagadas"
        ? todas.filter((f) => saldo(f) <= 0.01)
        : todas;

  const adeudado = todas
    .filter((f) => saldo(f) > 0.01)
    .reduce((s, f) => s + saldo(f), 0);

  return (
    <div className="space-y-6">
      <EncabezadoPanel
        titulo="Facturas de compra"
        detalle={
          adeudado > 0
            ? `Lo que nos facturaron. Quedan ${formatearMonto(adeudado)} sin pagar.`
            : "Lo que nos facturaron. No queda nada sin pagar."
        }
      >
        <Link
          href="/admin/arca/libro-iva-compras"
          className="inline-flex h-11 items-center gap-1.5 rounded-lg border border-linea px-4 text-base font-medium hover:bg-hundida"
        >
          Libro IVA compras
        </Link>
      </EncabezadoPanel>

      <FiltroDePago actual={pago} />

      <CargarFactura proveedores={proveedores} />

      <section className="tarjeta overflow-hidden">
        {facturas.length === 0 ? (
          <Vacio
            icono={FileText}
            titulo={
              pago === "pendiente"
                ? "No queda ninguna factura sin pagar"
                : pago === "pagadas"
                  ? "Todavía no hay ninguna factura pagada del todo"
                  : "Todavía no se cargó ninguna factura de compra"
            }
            detalle={
              pago === "todas"
                ? "Se cargan con el formulario de arriba, a medida que llegan."
                : undefined
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-base">
              <thead>
                <tr className="border-b border-linea text-left text-sm uppercase tracking-wide text-muted-foreground">
                  <th className="px-5 py-2.5 font-semibold">Fecha</th>
                  <th className="px-5 py-2.5 font-semibold">Comprobante</th>
                  <th className="px-5 py-2.5 font-semibold">Proveedor</th>
                  <th className="px-5 py-2.5 font-semibold">Vence</th>
                  <th className="px-5 py-2.5 text-right font-semibold">Neto</th>
                  <th className="px-5 py-2.5 text-right font-semibold">Total</th>
                  <th className="px-5 py-2.5 text-right font-semibold">Pago</th>
                  <th className="px-5 py-2.5 text-right font-semibold">
                    <span className="sr-only">Acciones</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-linea">
                {facturas.map((f) => (
                  <tr key={f.id}>
                    <td className="tabular px-5 py-3 text-muted-foreground">
                      {f.fechaEmision.toLocaleDateString("es-AR")}
                    </td>
                    <td className="px-5 py-3">
                      <span className="tabular block">
                        {numeroDeCompra(f.puntoVenta, f.numero)}
                      </span>
                      <span className="block text-sm text-muted-foreground">
                        {nombreComprobanteCompra(f.tipo)}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      <Link
                        href={`/admin/proveedores/${f.supplierId}`}
                        className="hover:underline"
                      >
                        {f.proveedor}
                      </Link>
                    </td>
                    <td className="tabular px-5 py-3 text-muted-foreground">
                      {f.fechaVencimiento
                        ? f.fechaVencimiento.toLocaleDateString("es-AR")
                        : "—"}
                    </td>
                    <td className="tabular px-5 py-3 text-right text-muted-foreground">
                      {formatearMonto(Number(f.neto))}
                    </td>
                    <td className="tabular px-5 py-3 text-right font-semibold">
                      {formatearMonto(Number(f.total))}
                    </td>
                    {/* Si está paga, a medias o sin tocar: sale de lo imputado
                        en los pagos, no de un estado que alguien marque. */}
                    <td className="px-5 py-3 text-right">
                      {(() => {
                        const pagado = Number(f.pagado);
                        const total = Number(f.total);
                        if (pagado >= total - 0.01) {
                          return (
                            <span className="font-medium text-saldo-favor">
                              Pagada
                            </span>
                          );
                        }
                        if (pagado > 0) {
                          return (
                            <span className="tabular text-sm text-muted-foreground">
                              {formatearMonto(pagado)} de{" "}
                              {formatearMonto(total)}
                            </span>
                          );
                        }
                        return (
                          <span className="text-sm text-muted-foreground">
                            Sin imputar
                          </span>
                        );
                      })()}
                    </td>
                    {/*
                      La acción que la fila estaba pidiendo.

                      La pantalla ya sabía cuáles estaban impagas y no ofrecía
                      nada: había que ir a Pagos por el menú y volver a elegir
                      el proveedor a mano. Ahora el formulario llega con el
                      proveedor puesto y esta factura imputada por su saldo.
                    */}
                    <td className="px-5 py-3 text-right">
                      {saldo(f) > 0.01 && (
                        <Link
                          href={`/admin/compras/pagos?proveedor=${f.supplierId}&factura=${f.id}`}
                          className="inline-flex h-10 items-center rounded-lg border border-linea px-3 text-base font-medium hover:bg-hundida"
                        >
                          Pagar
                        </Link>
                      )}
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
