import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { esUuid } from "@/lib/uuid";
import { ArrowLeft } from "lucide-react";
import { requireStaffRole } from "@/lib/dal/session";
import { obtenerOrdenDeCompra } from "@/lib/dal/admin/ordenes-compra";
import { obtenerProveedor } from "@/lib/dal/admin/proveedores";
import { diasHasta, enlaceDeWhatsapp, fechaCorta, formatearMonto } from "@/lib/formato";
import { AccionesDeOrden } from "./acciones";

export const metadata: Metadata = { title: "Orden de compra" };

const ESTADOS: Record<string, { texto: string; clase: string }> = {
  borrador: { texto: "Borrador", clase: "estado-espera" },
  enviada: { texto: "Enviada", clase: "estado-espera" },
  parcial: { texto: "Llegó parte", clase: "estado-espera" },
  completa: { texto: "Completa", clase: "estado-ok" },
  anulada: { texto: "Anulada", clase: "estado-problema" },
};

type Renglon = { costoUnitario: string; costoRecibido?: string | null };

/** El costo con que llegó, si no es el pedido. */
function costoDistinto(i: Renglon): number | null {
  if (!i.costoRecibido) return null;
  const llego = Number(i.costoRecibido);
  return Math.abs(llego - Number(i.costoUnitario)) > 0.005 ? llego : null;
}

/**
 * Lo que falta de un renglón: el número, «completo», o lo que llegó de más
 * resaltado («+1»): 21 de 20 decía «completo» sin ninguna marca (M2S2-079).
 */
function Falta({
  estado,
  pendiente,
  cantidad,
  corto,
  atrasada,
}: {
  estado: string;
  pendiente: number;
  cantidad: (n: number) => string;
  corto?: boolean;
  /** Pasó la fecha prometida, o se cerró sin que llegue: recién ahí va en rojo (M4-013, M4-049). */
  atrasada: boolean;
}) {
  if (estado === "anulada") return <span className="text-muted-foreground">—</span>;
  if (pendiente > 0)
    return (
      <span className={atrasada ? "font-semibold text-saldo-debe" : "font-medium"}>
        {corto ? `falta ${cantidad(pendiente)}` : cantidad(pendiente)}
      </span>
    );
  if (pendiente < 0) return <span className="font-semibold text-acento-sobre-claro">+{cantidad(-pendiente)}</span>;
  return <span className="text-saldo-favor">completo</span>;
}

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
  const llegoAlgo = orden.items.some((i) => Number(i.cantidadRecibida) > 0);
  // Completa con renglones que no llegaron: se cerró con faltante (M2S3-013).
  const conFaltante = orden.estado === "completa" && falta;
  const vencida = (diasHasta(orden.fechaPrometida) ?? 0) < 0;
  const atrasada = conFaltante || ((orden.estado === "enviada" || orden.estado === "parcial") && vencida);
  const recepciones = orden.recepciones ?? [];
  // Al cerrarla, Go suma «Cerrada con faltante: motivo» a las notas: con la
  // chapa del estado se leía dos veces (mes 23). Queda el motivo.
  const notas = (orden.notas ?? "")
    .split(" · ")
    .map((n) => (conFaltante ? n.replace(/^Cerrada con faltante(: )?/, "") : n))
    .filter((n) => n.trim() !== "")
    .join(" · ");
  const proveedor = await obtenerProveedor(orden.supplierId);
  /*
   * La orden como se le manda al proveedor (mes simulado, H197: había que
   * dictarla por teléfono): qué, cuánto, a qué costo pactado, dónde y para
   * cuándo. Es lo que después sirve para reclamar diferencias.
   */
  const cantidad = (n: number) => n.toLocaleString("es-AR", { maximumFractionDigits: 2 });
  // Al que no discrimina IVA (factura C) no se le pide «+ IVA» (M4-003).
  const masIva = proveedor?.condicionIva && proveedor.condicionIva !== "responsable_inscripto" ? "" : " + IVA";
  const mensaje = [
    `Orden de compra ${orden.numero}`,
    orden.sucursal ? `Entregar en ${orden.sucursal}` : null,
    orden.fechaPrometida ? `Para el ${fechaCorta.format(orden.fechaPrometida)}` : null,
    "",
    ...orden.items.map(
      (i) => `${cantidad(Number(i.cantidad))} × ${i.descripcion} a ${formatearMonto(Number(i.costoUnitario))}${masIva}`,
    ),
    "",
    masIva ? `Neto ${formatearMonto(neto)}${masIva}` : `Total ${formatearMonto(neto)}`,
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
            className={`${conFaltante ? "estado-espera" : estado.clase} inline-flex items-center rounded-lg bg-[var(--estado-fondo)] px-3 py-1.5 text-base font-semibold`}
          >
            {conFaltante ? "Cerrada con faltante" : estado.texto}
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
              const otroCosto = costoDistinto(i);
              return (
                <tr key={i.id}>
                  <td className="px-4 py-2.5">{i.descripcion}</td>
                  <td className="tabular px-4 py-2.5 text-right">{cantidad(pedido)}</td>
                  <td className="tabular px-4 py-2.5 text-right text-muted-foreground">{cantidad(recibido)}</td>
                  <td className="tabular px-4 py-2.5 text-right">
                    <Falta estado={orden.estado} pendiente={pendiente} cantidad={cantidad} atrasada={atrasada} />
                  </td>
                  <td className="tabular px-4 py-2.5 text-right">
                    {formatearMonto(Number(i.costoUnitario))}
                    {otroCosto !== null && (
                      <span className="block text-sm font-semibold text-acento-sobre-claro">
                        llegó a {formatearMonto(otroCosto)}
                      </span>
                    )}
                  </td>
                  <td className="tabular px-4 py-2.5 text-right font-semibold">
                    {formatearMonto(pedido * Number(i.costoUnitario))}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {/* En el teléfono, el renglón que no llegó dice cuánto falta: se veía
            igual que los completos (M2S1-035). */}
        <ul className="divide-y divide-linea @3xl:hidden">
          {orden.items.map((i) => {
            const pedido = Number(i.cantidad);
            const recibido = Number(i.cantidadRecibida);
            const otroCosto = costoDistinto(i);
            return (
              <li key={i.id} className="space-y-0.5 px-4 py-3">
                <p className="flex items-baseline justify-between gap-3">
                  <span className="text-base font-medium">{i.descripcion}</span>
                  <span className="tabular shrink-0 text-base">
                    <Falta estado={orden.estado} pendiente={pedido - recibido} cantidad={cantidad} corto atrasada={atrasada} />
                  </span>
                </p>
                <p className="tabular flex items-baseline justify-between gap-3 text-base">
                  <span className="text-muted-foreground">
                    {cantidad(pedido)} × {formatearMonto(Number(i.costoUnitario))}
                    {recibido > 0 && ` · llegaron ${cantidad(recibido)}`}
                  </span>
                  <span className="font-semibold">{formatearMonto(pedido * Number(i.costoUnitario))}</span>
                </p>
                {otroCosto !== null && (
                  <p className="tabular text-sm font-semibold text-acento-sobre-claro">llegó a {formatearMonto(otroCosto)}</p>
                )}
              </li>
            );
          })}
        </ul>

        <div className="flex items-baseline justify-between gap-3 border-t border-linea px-4 py-3">
          <span className="font-semibold">Neto de la orden</span>
          <span className="tabular text-lg font-bold">{formatearMonto(neto)}</span>
        </div>
      </section>

      {/* Los remitos que llegaron contra la orden, con su enlace (M2S1-035). */}
      {recepciones.length > 0 && (
        <section className="tarjeta p-5">
          <h2 className="text-[19px] font-bold tracking-tight">Remitos</h2>
          <ul className="mt-2 divide-y divide-linea-suave">
            {recepciones.map((r) => (
              <li key={r.id}>
                <Link
                  href={`/admin/recepciones/${r.id}`}
                  className={`flex items-baseline justify-between gap-3 py-2.5 hover:underline ${
                    r.estado === "anulada" ? "text-muted-foreground line-through" : ""
                  }`}
                >
                  <span className="codigo font-medium">{r.numeroRemito ?? "Sin remito"}</span>
                  <span className="tabular text-muted-foreground">{fechaCorta.format(new Date(r.fecha))}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {notas && <p className="text-base text-muted-foreground">{notas}</p>}

      <AccionesDeOrden
        id={orden.id}
        estado={orden.estado}
        falta={falta}
        llegoAlgo={llegoAlgo}
        fechaPrometida={orden.fechaPrometida ? new Date(orden.fechaPrometida).toISOString().slice(0, 10) : ""}
        whatsapp={whatsapp}
        correo={correo}
        borrador={orden.borradorAbierto}
      />
    </div>
  );
}
