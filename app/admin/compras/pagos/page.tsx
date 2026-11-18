import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Download, FileCheck2, Wallet } from "lucide-react";
import { requireStaff } from "@/lib/dal/session";
import { puedeEntrar } from "@/lib/roles";
import {
  listarPagosAProveedores,
  regimenesActivos,
} from "@/lib/dal/admin/pagos-proveedor";
import { listarProveedores } from "@/lib/dal/admin/proveedores";
import { sucursalesParaGasto } from "@/lib/dal/admin/gastos";
import { fechaCorta, formatearMonto, plural } from "@/lib/formato";
import { etiquetaDeCircuito } from "@/lib/circuito";
import { EncabezadoPanel } from "@/components/admin/encabezado";
import { Vacio } from "@/components/admin/vacio";
import { FormularioPago } from "./formulario";
import { NOMBRE_DEL_MEDIO } from "./medios";

export const metadata: Metadata = { title: "Pagos a proveedores" };

/**
 * Los pagos y las retenciones que los acompañan.
 *
 * **La retención no es un gasto: es parte del pago.** Se le pagan $100 con $95
 * de transferencia y $5 de retención, y la deuda queda saldada en $100. Por eso
 * la tabla muestra las tres columnas juntas: lo que se aplicó, lo que salió del
 * banco y lo retenido. Mostrar solo la transferencia haría que el saldo del
 * proveedor no cuadre contra la suma de los pagos.
 *
 * Cada fila lleva a la ficha del pago, donde están la orden de pago y la
 * anulación (antes, un desplegable metido en la celda de la fecha).
 */
export default async function PagosPage({
  searchParams,
}: {
  /*
   * `proveedor` y `factura` llegan desde una factura impaga o la ficha del
   * proveedor, para que pagar sea un botón y no un recorrido.
   */
  searchParams: Promise<{ proveedor?: string; factura?: string }>;
}) {
  const usuario = await requireStaff();
  if (!puedeEntrar("/admin/compras/pagos", usuario.staffRole)) notFound();

  const { proveedor: proveedorInicial, factura: facturaInicial } =
    await searchParams;

  const [pagos, proveedores, regimenes, sucursales] = await Promise.all([
    listarPagosAProveedores(),
    // Todos, no solo los activos: dejar de comprarle a alguien no salda su
    // cuenta. Se ofrecen los activos y los inactivos que deben, así la
    // deuda se puede pagar y el total es el mismo «Debo» del Resumen.
    listarProveedores(),
    regimenesActivos(),
    sucursalesParaGasto(),
  ]);

  const conDeuda = proveedores.filter((p) => p.saldo > 0.005);
  // Un anticipo no resta la deuda con otro, pero tiene que verse: es plata
  // que ya salió.
  const aFavor = proveedores.filter((p) => p.saldo < -0.005);
  // Los que tienen deuda, primero: son a los que se les paga. Un inactivo
  // sin deuda no se ofrece.
  const ordenados = [
    ...conDeuda,
    ...proveedores.filter((p) => p.saldo <= 0.005 && p.estado === "activo"),
  ];
  const resumen = [
    conDeuda.length > 0
      ? `Se les deben ${formatearMonto(conDeuda.reduce((s, p) => s + p.saldo, 0))} a ${plural(conDeuda.length, "proveedor", "proveedores")}`
      : "Sin deuda con proveedores",
    aFavor.length > 0 &&
      `${formatearMonto(-aFavor.reduce((s, p) => s + p.saldo, 0))} a favor con ${plural(aFavor.length, "proveedor", "proveedores")}`,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="space-y-6">
      <EncabezadoPanel
        titulo="Pagos a proveedores"
        resumen={resumen}
      >
        {/* Es un archivo (una ruta que contesta un CSV), no una página: el
            enlace tiene que ser una descarga. La regla lo confunde con la
            ficha /admin/compras/pagos/[id]. */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a
          href="/admin/compras/pagos/exportar"
          className="tarjeta-hundida inline-flex h-11 items-center gap-1.5 rounded-xl px-4 text-base font-medium"
        >
          <Download className="h-4 w-4" />
          Retenciones del mes
        </a>
      </EncabezadoPanel>

      <FormularioPago
        proveedores={ordenados.map((p) => ({
          id: p.id,
          nombre: p.estado === "inactivo" ? `${p.nombre} · inactivo` : p.nombre,
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
        sucursales={sucursales}
        proveedorInicial={proveedorInicial}
        facturaInicial={facturaInicial}
      />

      <section className="tarjeta overflow-hidden">
        <h2 className="px-5 pt-5 text-[19px] font-bold tracking-tight">Pagos hechos</h2>
        {pagos.length === 0 ? (
          <Vacio icono={Wallet} titulo="Todavía no se registró ningún pago" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-base">
              <thead>
                <tr className="border-b border-linea text-left text-sm uppercase tracking-wide text-muted-foreground">
                  <th className="px-5 py-2.5 font-semibold">Fecha</th>
                  <th className="px-5 py-2.5 font-semibold">Proveedor</th>
                  <th className="px-5 py-2.5 font-semibold">Forma de pago</th>
                  <th className="px-5 py-2.5 text-right font-semibold">Aplicado</th>
                  <th className="px-5 py-2.5 text-right font-semibold">Retenido</th>
                  <th className="px-5 py-2.5 text-right font-semibold">Pagado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-linea">
                {pagos.map((p) => (
                  <tr key={p.id} className={p.anuladoAt ? "text-muted-foreground" : undefined}>
                    <td className="tabular px-5 py-3">
                      <Link href={`/admin/compras/pagos/${p.id}`} className="font-medium hover:underline">
                        {fechaCorta.format(p.fecha)}
                      </Link>
                      {p.anuladoAt && (
                        <span className="block text-sm font-medium text-saldo-debe">Anulado</span>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      <Link href={`/admin/proveedores/${p.supplierId}`} className="hover:underline">
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
                    <td className="px-5 py-3">
                      {NOMBRE_DEL_MEDIO[p.medio] ?? p.medio}
                      {p.referencia && (
                        <span className="tabular block text-sm text-muted-foreground">{p.referencia}</span>
                      )}
                      {/* Por qué circuito salió: el mismo dato que separa los
                          totales de gastos. Ver lib/db/schema/circuito.ts. */}
                      <span className="block text-sm text-muted-foreground">
                        {etiquetaDeCircuito(p.circuito)}
                      </span>
                    </td>
                    <td
                      className={`tabular px-5 py-3 text-right font-semibold ${p.anuladoAt ? "line-through" : ""}`}
                    >
                      {formatearMonto(p.total)}
                      {/* Contra qué se aplicó: sin esto la tabla contestaba
                          "salieron $800.000" y no "de qué facturas". */}
                      {p.facturas.length > 0 ? (
                        <span className="mt-0.5 flex flex-col items-end gap-0.5 text-sm font-normal text-muted-foreground">
                          {p.facturas.map((f) => (
                            <Link
                              key={f.id}
                              href={`/admin/compras/facturas/${f.id}`}
                              className="tabular hover:underline"
                            >
                              {f.numero} · {formatearMonto(f.importe)}
                            </Link>
                          ))}
                        </span>
                      ) : (
                        <span className="mt-0.5 block text-sm font-normal text-muted-foreground">
                          A cuenta, sin aplicar
                        </span>
                      )}
                    </td>
                    <td className="tabular px-5 py-3 text-right text-muted-foreground">
                      {p.retenido > 0 ? formatearMonto(p.retenido) : "—"}
                    </td>
                    <td className="tabular px-5 py-3 text-right">{formatearMonto(p.neto)}</td>
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
