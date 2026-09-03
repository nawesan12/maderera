import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireStaffRole } from "@/lib/dal/session";
import { obtenerOrdenDeCompra } from "@/lib/dal/admin/ordenes-compra";
import { formatearMonto } from "@/lib/formato";
import { AccionesDeOrden } from "./acciones";

export const metadata: Metadata = { title: "Orden de compra" };

const ESTADOS: Record<string, { texto: string; clase: string }> = {
  borrador: { texto: "Borrador", clase: "estado-espera" },
  enviada: { texto: "Enviada", clase: "estado-ok" },
  parcial: { texto: "Llegó parte", clase: "estado-espera" },
  completa: { texto: "Completa", clase: "estado-ok" },
  anulada: { texto: "Anulada", clase: "estado-problema" },
};

export default async function OrdenPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireStaffRole("admin");

  const { id } = await params;
  const orden = await obtenerOrdenDeCompra(id);
  if (!orden) notFound();

  const estado = ESTADOS[orden.estado] ?? ESTADOS.borrador;
  const neto = orden.items.reduce(
    (t, i) => t + Number(i.cantidad) * Number(i.costoUnitario),
    0,
  );
  const falta = orden.items.some(
    (i) => Number(i.cantidadRecibida) < Number(i.cantidad),
  );

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/admin/compras/ordenes"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Órdenes de compra
        </Link>

        <header className="mt-2 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="tabular text-[26px] font-bold tracking-tight">
              {orden.numero}
            </h1>
            <p className="mt-1 text-base text-muted-foreground">
              {[
                orden.proveedor,
                orden.sucursal,
                orden.fechaPrometida
                  ? `prometida para el ${orden.fechaPrometida.toLocaleDateString("es-AR")}`
                  : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>

          <span
            className={`${estado.clase} inline-flex items-center rounded-lg bg-[var(--estado-fondo)] px-3 py-1.5 text-base font-semibold`}
          >
            {estado.texto}
          </span>
        </header>
      </div>

      <section className="tarjeta overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-base">
            <thead>
              <tr className="border-b border-linea text-left text-sm uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-2.5 font-semibold">Mercadería</th>
                <th className="px-4 py-2.5 text-right font-semibold">Pedido</th>
                <th className="px-4 py-2.5 text-right font-semibold">Llegó</th>
                <th className="px-4 py-2.5 text-right font-semibold">Falta</th>
                <th className="px-4 py-2.5 text-right font-semibold">Costo</th>
                <th className="px-4 py-2.5 text-right font-semibold">Subtotal</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-linea">
              {orden.items.map((i) => {
                const pedido = Number(i.cantidad);
                const recibido = Number(i.cantidadRecibida);
                const pendiente = pedido - recibido;

                return (
                  <tr key={i.id}>
                    <td className="px-4 py-2.5">{i.descripcion}</td>
                    <td className="tabular px-4 py-2.5 text-right">{pedido}</td>
                    <td className="tabular px-4 py-2.5 text-right text-muted-foreground">
                      {recibido}
                    </td>
                    <td className="tabular px-4 py-2.5 text-right">
                      {pendiente > 0 ? (
                        <span className="font-semibold">{pendiente}</span>
                      ) : (
                        <span className="text-saldo-favor">completo</span>
                      )}
                    </td>
                    <td className="tabular px-4 py-2.5 text-right">
                      {formatearMonto(Number(i.costoUnitario))}
                    </td>
                    <td className="tabular px-4 py-2.5 text-right font-semibold">
                      {formatearMonto(pedido * Number(i.costoUnitario))}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="border-t border-linea">
              <tr>
                <td className="px-4 py-3 font-semibold" colSpan={5}>
                  Neto de la orden
                </td>
                <td className="tabular px-4 py-3 text-right text-lg font-bold">
                  {formatearMonto(neto)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      {orden.notas && (
        <p className="text-base text-muted-foreground">{orden.notas}</p>
      )}

      <AccionesDeOrden id={orden.id} estado={orden.estado} falta={falta} />
    </div>
  );
}
