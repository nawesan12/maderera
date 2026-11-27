import type { Metadata } from "next";
import Link from "next/link";
import { ClipboardList, Plus } from "lucide-react";
import { requireStaffRole } from "@/lib/dal/session";
import { listarOrdenesDeCompra } from "@/lib/dal/admin/ordenes-compra";
import { diasHasta, fechaCorta, formatearMonto } from "@/lib/formato";
import { Vacio } from "@/components/admin/vacio";

export const metadata: Metadata = { title: "Órdenes de compra" };

const ESTADOS: Record<string, { texto: string; clase: string }> = {
  borrador: { texto: "Borrador", clase: "estado-espera" },
  // Enviada todavía espera: no se pinta como la completa.
  enviada: { texto: "Enviada", clase: "estado-espera" },
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
          {/* Sin nada en camino no hay bajada: decía «lo que se le pidió a cada proveedor y qué falta que llegue». */}
          {enCamino.length > 0 && (
            <p className="mt-1 text-base text-muted-foreground">
              {`${enCamino.length} en camino por ${formatearMonto(enCamino.reduce((s, o) => s + o.porLlegar, 0))}.`}
            </p>
          )}
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
          <Vacio
            icono={ClipboardList}
            titulo="Todavía no hay órdenes de compra"
            accion={{ texto: "Nueva orden", href: "/admin/compras/ordenes/nueva" }}
          />
        ) : (
          <ListaDeOrdenes ordenes={ordenes} />
        )}
      </section>
    </div>
  );
}

type Orden = Awaited<ReturnType<typeof listarOrdenesDeCompra>>[number];

/** Completa con renglones que no llegaron: se cerró con faltante (M2S3-013). */
const conFaltante = (o: Orden) => o.estado === "completa" && o.pendientes > 0;

function Estado({ o }: { o: Orden }) {
  const e = conFaltante(o) ? { texto: "Cerrada con faltante", clase: "estado-espera" } : (ESTADOS[o.estado] ?? ESTADOS.borrador);
  return (
    <span className={`${e.clase} inline-flex shrink-0 items-center rounded-lg bg-[var(--estado-fondo)] px-2.5 py-1 text-sm font-semibold`}>
      {e.texto}
    </span>
  );
}

/** El neto: el de lo que llegó, en una cerrada con faltante. */
const netoDe = (o: Orden) => (conFaltante(o) ? (o.recibido ?? o.neto) : o.neto);

/** La fecha prometida; vencida con la orden abierta, en rojo. */
function Prometida({ o }: { o: Orden }) {
  if (!o.fechaPrometida) return <span className="text-muted-foreground">—</span>;
  const dias = diasHasta(o.fechaPrometida);
  const atrasada = dias !== null && dias < 0 && (o.estado === "enviada" || o.estado === "parcial");
  return (
    <span className={atrasada ? "font-medium text-saldo-debe" : "text-muted-foreground"}>
      {fechaCorta.format(o.fechaPrometida)}
      {/* Una fecha vencida con la orden todavía abierta es el motivo por el
          que alguien levanta el teléfono. */}
      {atrasada && " · vencida"}
    </span>
  );
}

/** Los renglones que faltan; una orden anulada o completa no espera nada. */
function Pendientes({ o }: { o: Orden }) {
  if (o.estado === "anulada" || o.estado === "completa" || o.pendientes === 0) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="font-semibold">
      {o.pendientes} de {o.lineas}
    </span>
  );
}

/**
 * Las órdenes en tabla donde entra; si no, una tarjeta de tres renglones:
 * el número y el estado, el proveedor, y la sucursal con la fecha y el neto.
 * Apilada, cada orden medía 470 px con un rótulo por renglón.
 */
function ListaDeOrdenes({ ordenes }: { ordenes: Orden[] }) {
  return (
    <div className="@container">
      <table className="hidden w-full text-base @4xl:table" data-tabla="fija">
        <thead>
          <tr className="border-b border-linea text-left text-sm uppercase tracking-wide text-muted-foreground">
            <th className="px-5 py-2.5 font-semibold">Orden</th>
            <th className="px-5 py-2.5 font-semibold">Proveedor</th>
            <th className="px-5 py-2.5 font-semibold">Sucursal</th>
            <th className="px-5 py-2.5 font-semibold">Llega</th>
            <th className="px-5 py-2.5 text-right font-semibold">Pendientes</th>
            <th className="px-5 py-2.5 text-right font-semibold">Neto</th>
            <th className="px-5 py-2.5 font-semibold">Estado</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-linea">
          {ordenes.map((o) => (
            <tr key={o.id} className="hover:bg-hundida">
              <td className="px-5 py-3">
                <Link href={`/admin/compras/ordenes/${o.id}`} className="codigo font-semibold hover:underline">
                  {o.numero}
                </Link>
              </td>
              <td className="px-5 py-3">{o.proveedor}</td>
              <td className="px-5 py-3 text-muted-foreground">{o.sucursal ?? "—"}</td>
              <td className="tabular px-5 py-3">
                <Prometida o={o} />
              </td>
              <td className="tabular px-5 py-3 text-right">
                <Pendientes o={o} />
              </td>
              <td className="tabular px-5 py-3 text-right font-semibold">{formatearMonto(netoDe(o))}</td>
              <td className="px-5 py-3">
                <Estado o={o} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <ul className="divide-y divide-linea @4xl:hidden">
        {ordenes.map((o) => (
          <li key={o.id}>
            <Link href={`/admin/compras/ordenes/${o.id}`} className="block space-y-1 px-4 py-3 hover:bg-hundida">
              <span className="flex items-center justify-between gap-3">
                <span className="codigo text-[17px] font-semibold">{o.numero}</span>
                <Estado o={o} />
              </span>
              {/* El neto va con el proveedor y la fecha con la sucursal,
                  enteras las dos: con el neto al lado, a 375 px la sucursal
                  quedaba en «Casa Cen…» (mes simulado). */}
              <span className="flex items-baseline justify-between gap-3 text-base">
                <span className="line-clamp-2 min-w-0 break-words">{o.proveedor}</span>
                <span className="tabular shrink-0 font-semibold">{formatearMonto(netoDe(o))}</span>
              </span>
              <span className="block text-base">
                <Prometida o={o} />
                {o.sucursal && <span className="text-muted-foreground"> · {o.sucursal}</span>}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
