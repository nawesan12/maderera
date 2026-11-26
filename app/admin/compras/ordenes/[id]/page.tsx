import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { esUuid } from "@/lib/uuid";
import { ArrowLeft } from "lucide-react";
import { requireStaffRole } from "@/lib/dal/session";
import { obtenerOrdenDeCompra } from "@/lib/dal/admin/ordenes-compra";
import { obtenerProveedor } from "@/lib/dal/admin/proveedores";
import { enlaceDeWhatsapp, fechaCorta, formatearMonto } from "@/lib/formato";
import { AccionesDeOrden } from "./acciones";

export const metadata: Metadata = { title: "Orden de compra" };

const ESTADOS: Record<string, { texto: string; clase: string }> = {
  borrador: { texto: "Borrador", clase: "estado-espera" },
  enviada: { texto: "Enviada", clase: "estado-espera" },
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

  if (!esUuid(id)) notFound();
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
  const proveedor = await obtenerProveedor(orden.supplierId);
  /*
   * La orden como se le manda al proveedor (mes simulado, H197: había que
   * dictarla por teléfono): qué, cuánto, a qué costo pactado, dónde y para
   * cuándo. Es lo que después sirve para reclamar diferencias.
   */
  const cantidad = (n: number) => n.toLocaleString("es-AR", { maximumFractionDigits: 2 });
  const mensaje = [
    `Orden de compra ${orden.numero}`,
    orden.sucursal ? `Entregar en ${orden.sucursal}` : null,
    orden.fechaPrometida ? `Para el ${fechaCorta.format(orden.fechaPrometida)}` : null,
    "",
    ...orden.items.map(
      (i) => `${cantidad(Number(i.cantidad))} × ${i.descripcion} a ${formatearMonto(Number(i.costoUnitario))} + IVA`,
    ),
    "",
    `Neto ${formatearMonto(neto)} + IVA`,
    orden.notas ? `\n${orden.notas}` : null,
  ]
    .filter((l) => l !== null)
    .join("\n");
  const whatsapp = proveedor?.telefono ? enlaceDeWhatsapp(proveedor.telefono, mensaje) : null;
  const correo = proveedor?.email
    ? `mailto:${proveedor.email}?subject=${encodeURIComponent(`Orden de compra ${orden.numero}`)}&body=${encodeURIComponent(mensaje)}`
    : null;

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
                  ? `para el ${fechaCorta.format(orden.fechaPrometida)}`
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

      <section className="tarjeta @container overflow-hidden">
        <table className="hidden w-full text-base @3xl:table" data-tabla="fija">
          <thead>
            <tr className="border-b border-linea text-left text-sm uppercase tracking-wide text-muted-foreground">
              <th className="px-4 py-2.5 font-semibold">Mercadería</th>
              <th className="px-4 py-2.5 text-right font-semibold">Pedido</th>
              <th className="px-4 py-2.5 text-right font-semibold">Ya llegó</th>
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
                  <td className="tabular px-4 py-2.5 text-right">{cantidad(pedido)}</td>
                  <td className="tabular px-4 py-2.5 text-right text-muted-foreground">{cantidad(recibido)}</td>
                  <td className="tabular px-4 py-2.5 text-right">
                    {orden.estado === "anulada" ? (
                      <span className="text-muted-foreground">—</span>
                    ) : pendiente > 0 ? (
                      <span className="font-semibold">{cantidad(pendiente)}</span>
                    ) : (
                      <span className="text-saldo-favor">completo</span>
                    )}
                  </td>
                  <td className="tabular px-4 py-2.5 text-right">{formatearMonto(Number(i.costoUnitario))}</td>
                  <td className="tabular px-4 py-2.5 text-right font-semibold">
                    {formatearMonto(pedido * Number(i.costoUnitario))}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <ul className="divide-y divide-linea @3xl:hidden">
          {orden.items.map((i) => {
            const pedido = Number(i.cantidad);
            const recibido = Number(i.cantidadRecibida);
            return (
              <li key={i.id} className="space-y-0.5 px-4 py-3">
                <p className="text-base font-medium">{i.descripcion}</p>
                <p className="tabular flex items-baseline justify-between gap-3 text-base">
                  <span className="text-muted-foreground">
                    {cantidad(pedido)} × {formatearMonto(Number(i.costoUnitario))}
                    {recibido > 0 && ` · llegaron ${cantidad(recibido)}`}
                  </span>
                  <span className="font-semibold">{formatearMonto(pedido * Number(i.costoUnitario))}</span>
                </p>
              </li>
            );
          })}
        </ul>

        <div className="flex items-baseline justify-between gap-3 border-t border-linea px-4 py-3">
          <span className="font-semibold">Neto de la orden</span>
          <span className="tabular text-lg font-bold">{formatearMonto(neto)}</span>
        </div>
      </section>

      {orden.notas && (
        <p className="text-base text-muted-foreground">{orden.notas}</p>
      )}

      <AccionesDeOrden
        id={orden.id}
        estado={orden.estado}
        falta={falta}
        whatsapp={whatsapp}
        correo={correo}
        borrador={orden.borradorAbierto}
      />
    </div>
  );
}
