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
import { CargarFactura } from "./cargar";

export const metadata: Metadata = { title: "Facturas de compra" };

/**
 * Los comprobantes que recibimos.
 *
 * Es la capa fiscal de las compras y va aparte de las recepciones a propósito:
 * la recepción dice qué entró al depósito, la factura dice qué crédito fiscal
 * se puede computar. Llegan por caminos distintos y a veces una factura cubre
 * tres remitos.
 */
export default async function FacturasDeCompraPage() {
  await requireStaffRole("admin");

  const [facturas, proveedores] = await Promise.all([
    listarFacturasDeCompra(),
    proveedoresParaElegir(),
  ]);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[26px] font-bold tracking-tight">
            Facturas de compra
          </h1>
          <p className="mt-1 text-base text-muted-foreground">
            Lo que nos facturaron. De acá sale el crédito fiscal del mes.
          </p>
        </div>
        <Link
          href="/admin/arca/libro-iva-compras"
          className="inline-flex h-11 items-center gap-1.5 rounded-lg border border-linea px-4 text-base font-medium hover:bg-hundida"
        >
          Libro IVA compras
        </Link>
      </header>

      <CargarFactura proveedores={proveedores} />

      <section className="tarjeta overflow-hidden">
        {facturas.length === 0 ? (
          <div className="px-5 py-14 text-center">
            <FileText className="mx-auto h-8 w-8 text-muted-foreground" />
            <p className="mt-3 text-base text-muted-foreground">
              Todavía no se cargó ninguna factura de compra.
            </p>
          </div>
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
