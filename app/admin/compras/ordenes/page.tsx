import type { Metadata } from "next";
import Link from "next/link";
import { ClipboardList, Plus } from "lucide-react";
import { requireStaffRole } from "@/lib/dal/session";
import { listarOrdenesDeCompra } from "@/lib/dal/admin/ordenes-compra";
import { formatearMonto } from "@/lib/formato";

export const metadata: Metadata = { title: "Órdenes de compra" };

const ESTADOS: Record<string, { texto: string; clase: string }> = {
  borrador: { texto: "Borrador", clase: "estado-espera" },
  enviada: { texto: "Enviada", clase: "estado-ok" },
  parcial: { texto: "Llegó parte", clase: "estado-espera" },
  completa: { texto: "Completa", clase: "estado-ok" },
  anulada: { texto: "Anulada", clase: "estado-problema" },
};

/**
 * Lo que se le pidió al proveedor.
 *
 * La columna que importa es la de renglones pendientes: es la respuesta a "¿ya
 * pedimos esto?", que hasta acá se contestaba de memoria y por eso se pedía dos
 * veces.
 */
export default async function OrdenesDeCompraPage() {
  await requireStaffRole("admin");

  const ordenes = await listarOrdenesDeCompra();
  const enCamino = ordenes.filter(
    (o) => o.estado === "enviada" || o.estado === "parcial",
  );

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[26px] font-bold tracking-tight">
            Órdenes de compra
          </h1>
          <p className="mt-1 text-base text-muted-foreground">
            {enCamino.length > 0
              ? `${enCamino.length} en camino por ${formatearMonto(enCamino.reduce((s, o) => s + o.neto, 0))}.`
              : "Lo que se le pidió a cada proveedor y qué falta que llegue."}
          </p>
        </div>
        <Link
          href="/admin/compras/ordenes/nueva"
          className="inline-flex h-11 items-center gap-1.5 rounded-lg boton-accion px-4 text-base font-medium transition-colors"
        >
          <Plus className="h-4 w-4" />
          Nueva orden
        </Link>
      </header>

      <section className="tarjeta overflow-hidden">
        {ordenes.length === 0 ? (
          <div className="px-5 py-14 text-center">
            <ClipboardList className="mx-auto h-8 w-8 text-muted-foreground" />
            <p className="mt-3 text-base text-muted-foreground">
              Todavía no hay órdenes de compra.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-base">
              <thead>
                <tr className="border-b border-linea text-left text-sm uppercase tracking-wide text-muted-foreground">
                  <th className="px-5 py-2.5 font-semibold">Orden</th>
                  <th className="px-5 py-2.5 font-semibold">Proveedor</th>
                  <th className="px-5 py-2.5 font-semibold">Sucursal</th>
                  <th className="px-5 py-2.5 font-semibold">Prometida</th>
                  <th className="px-5 py-2.5 text-right font-semibold">
                    Pendientes
                  </th>
                  <th className="px-5 py-2.5 text-right font-semibold">Neto</th>
                  <th className="px-5 py-2.5 font-semibold">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-linea">
                {ordenes.map((o) => {
                  const estado = ESTADOS[o.estado] ?? ESTADOS.borrador;
                  const atrasada =
                    o.fechaPrometida !== null &&
                    o.fechaPrometida < new Date() &&
                    (o.estado === "enviada" || o.estado === "parcial");

                  return (
                    <tr key={o.id} className="hover:bg-hundida">
                      <td className="px-5 py-3">
                        <Link
                          href={`/admin/compras/ordenes/${o.id}`}
                          className="tabular font-semibold hover:underline"
                        >
                          {o.numero}
                        </Link>
                      </td>
                      <td className="px-5 py-3">{o.proveedor}</td>
                      <td className="px-5 py-3 text-muted-foreground">
                        {o.sucursal ?? "—"}
                      </td>
                      <td className="tabular px-5 py-3">
                        {o.fechaPrometida ? (
                          <span
                            className={
                              atrasada
                                ? "text-saldo-debe font-medium"
                                : "text-muted-foreground"
                            }
                          >
                            {o.fechaPrometida.toLocaleDateString("es-AR")}
                            {/* Una fecha vencida con la orden todavía abierta es
                                el motivo por el que alguien levanta el teléfono.
                                Sin marcarla, la fecha es decoración. */}
                            {atrasada && " · vencida"}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="tabular px-5 py-3 text-right">
                        {o.pendientes > 0 ? (
                          <span className="font-semibold">
                            {o.pendientes} de {o.lineas}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="tabular px-5 py-3 text-right font-semibold">
                        {formatearMonto(o.neto)}
                      </td>
                      <td className="px-5 py-3">
                        <span
                          className={`${estado.clase} inline-flex items-center rounded-lg bg-[var(--estado-fondo)] px-2.5 py-1 text-sm font-semibold`}
                        >
                          {estado.texto}
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
