import type { Metadata } from "next";
import Link from "next/link";
import { Download, FileCheck2, Wallet } from "lucide-react";
import { requireStaffRole } from "@/lib/dal/session";
import {
  listarPagosAProveedores,
  regimenesActivos,
} from "@/lib/dal/admin/pagos-proveedor";
import { listarProveedores } from "@/lib/dal/admin/proveedores";
import { formatearMonto } from "@/lib/formato";
import { ETIQUETA_CIRCUITO } from "@/lib/db/schema/circuito";
import { FormularioPago } from "./formulario";

export const metadata: Metadata = { title: "Pagos a proveedores" };

/**
 * Los pagos y las retenciones que los acompañan.
 *
 * **La retención no es un gasto: es parte del pago.** Se le pagan $100 con $95
 * de transferencia y $5 de retención, y la deuda queda saldada en $100. Por eso
 * la tabla muestra las tres columnas juntas: lo que se imputó, lo que salió del
 * banco y lo retenido. Mostrar solo la transferencia haría que el saldo del
 * proveedor no cuadre contra la suma de los pagos.
 */
export default async function PagosPage({
  searchParams,
}: {
  /*
   * `proveedor` y `factura` llegan desde la pantalla de facturas de compra,
   * para que pagar una factura vencida sea un botón y no un recorrido.
   */
  searchParams: Promise<{ proveedor?: string; factura?: string }>;
}) {
  await requireStaffRole("admin");

  const { proveedor: proveedorInicial, factura: facturaInicial } =
    await searchParams;

  const [pagos, proveedores, regimenes] = await Promise.all([
    listarPagosAProveedores(),
    listarProveedores({ estado: "activo" }),
    regimenesActivos(),
  ]);

  const conDeuda = proveedores.filter((p) => p.saldo > 0.005);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[26px] font-bold tracking-tight">
            Pagos a proveedores
          </h1>
          <p className="mt-1 text-base text-muted-foreground">
            {conDeuda.length > 0
              ? `${conDeuda.length} proveedores con saldo, por ${formatearMonto(conDeuda.reduce((s, p) => s + p.saldo, 0))}.`
              : "No hay deuda pendiente con proveedores."}
          </p>
        </div>
        <a
          href="/admin/compras/pagos/exportar"
          className="inline-flex h-11 items-center gap-1.5 rounded-lg border border-linea px-4 text-base font-medium hover:bg-hundida"
        >
          <Download className="h-4 w-4" />
          Retenciones del mes
        </a>
      </header>

      <FormularioPago
        proveedores={conDeuda.map((p) => ({
          id: p.id,
          nombre: p.nombre,
          cuit: p.cuit,
          saldo: p.saldo,
        }))}
        regimenes={regimenes.map((r) => ({
          id: r.id,
          codigo: r.codigo,
          nombre: r.nombre,
          impuesto: r.impuesto,
          alicuota: Number(r.alicuota),
          minimoNoImponible: Number(r.minimoNoImponible),
        }))}
        proveedorInicial={proveedorInicial}
        facturaInicial={facturaInicial}
      />

      <section className="tarjeta overflow-hidden">
        {pagos.length === 0 ? (
          <div className="px-5 py-14 text-center">
            <Wallet className="mx-auto h-8 w-8 text-muted-foreground" />
            <p className="mt-3 text-base text-muted-foreground">
              Todavía no se registró ningún pago.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-base">
              <thead>
                <tr className="border-b border-linea text-left text-sm uppercase tracking-wide text-muted-foreground">
                  <th className="px-5 py-2.5 font-semibold">Fecha</th>
                  <th className="px-5 py-2.5 font-semibold">Proveedor</th>
                  <th className="px-5 py-2.5 font-semibold">Medio</th>
                  <th className="px-5 py-2.5 text-right font-semibold">
                    Imputado
                  </th>
                  <th className="px-5 py-2.5 text-right font-semibold">
                    Retenido
                  </th>
                  <th className="px-5 py-2.5 text-right font-semibold">Salió</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-linea">
                {pagos.map((p) => (
                  <tr key={p.id}>
                    <td className="tabular px-5 py-3 text-muted-foreground">
                      {p.fecha.toLocaleDateString("es-AR")}
                    </td>
                    <td className="px-5 py-3">
                      <Link
                        href={`/admin/proveedores/${p.supplierId}`}
                        className="hover:underline"
                      >
                        {p.proveedor}
                      </Link>
                      {p.numerosCertificado.length > 0 && (
                        <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
                          <FileCheck2 className="h-3.5 w-3.5" aria-hidden="true" />
                          {p.numerosCertificado.map((numero) => (
                            <a
                              key={numero}
                              href={`/admin/compras/pagos/certificado/${encodeURIComponent(numero)}`}
                              className="tabular hover:text-brand-orange hover:underline"
                            >
                              {numero}
                            </a>
                          ))}
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-muted-foreground">
                      {p.medio}
                      {p.referencia && (
                        <span className="tabular block text-sm">
                          {p.referencia}
                        </span>
                      )}
                      {/* Por qué circuito salió: el mismo dato que separa los
                          totales de gastos. Ver lib/db/schema/circuito.ts. */}
                      <span className="block text-sm">
                        {ETIQUETA_CIRCUITO[p.circuito] ?? p.circuito}
                      </span>
                    </td>
                    <td className="tabular px-5 py-3 text-right font-semibold">
                      {formatearMonto(p.total)}
                    </td>
                    <td className="tabular px-5 py-3 text-right text-muted-foreground">
                      {p.retenido > 0 ? formatearMonto(p.retenido) : "—"}
                    </td>
                    <td className="tabular px-5 py-3 text-right">
                      {formatearMonto(p.neto)}
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
