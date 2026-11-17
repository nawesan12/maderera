import Link from "next/link";
import { MapPin, Truck } from "lucide-react";
import { EncabezadoPanel } from "@/components/admin/encabezado";
import { EtiquetaEstado } from "@/components/admin/etiqueta-estado";
import { moneda, plural } from "@/components/admin/formato";
import { listarPedidos, type PedidoListado } from "@/lib/dal/admin/ventas";
import { requireStaff } from "@/lib/dal/session";
import { AccionesPedido } from "../pedidos/acciones";

export const metadata = { title: "Reparto" };

/**
 * El reparto: lo que hay que llevar, por zona.
 *
 * Los envíos estaban mezclados en el tablero de pedidos con lo que se retira,
 * y para armar el viaje del camión había que leer cada tarjeta. Acá van solos,
 * agrupados por zona: primero lo listo para cargar, después lo que todavía se
 * prepara (para saber qué falta antes de salir) y lo que ya está en la calle.
 */
export default async function RepartoPage() {
  await requireStaff();
  const pedidos = (await listarPedidos({ vista: "tablero" })).filter(
    (p) => p.tipoEntrega === "envio" && !["entregado", "cancelado"].includes(p.estado),
  );

  const porZona = new Map<string, PedidoListado[]>();
  for (const p of pedidos) {
    const zona = p.zonaEnvio?.trim() || "Sin zona";
    porZona.set(zona, [...(porZona.get(zona) ?? []), p]);
  }
  const ORDEN: Record<string, number> = { listo: 0, preparando: 1, pendiente: 2, "en-camino": 3 };
  const zonas = [...porZona.entries()]
    .map(([zona, ps]) => ({ zona, pedidos: ps.sort((a, b) => (ORDEN[a.estado] ?? 9) - (ORDEN[b.estado] ?? 9)) }))
    .sort((a, b) => b.pedidos.filter((p) => p.estado === "listo").length - a.pedidos.filter((p) => p.estado === "listo").length);

  const listos = pedidos.filter((p) => p.estado === "listo").length;

  return (
    <div>
      <EncabezadoPanel
        titulo="Reparto"
        resumen={
          pedidos.length === 0
            ? "Nada para llevar"
            : `${plural(listos, "pedido")} listo${listos === 1 ? "" : "s"} para cargar · ${plural(pedidos.length, "envío")} en total`
        }
      />

      {zonas.length === 0 ? (
        <div className="tarjeta-hundida rounded-xl py-16 text-center">
          <Truck className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
          <p className="text-base text-muted-foreground">No hay envíos pendientes.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {zonas.map(({ zona, pedidos: ps }) => (
            <section key={zona}>
              <h2 className="mb-2.5 flex items-baseline gap-2 text-lg font-semibold">
                <MapPin className="h-5 w-5 self-center text-brand-orange" aria-hidden="true" />
                {zona}
                <span className="text-base font-normal text-muted-foreground">
                  {plural(ps.length, "pedido")} · {moneda.format(ps.reduce((s, p) => s + p.total, 0))}
                </span>
              </h2>
              <ul className="tarjeta overflow-hidden">
                {ps.map((p) => (
                  <li
                    key={p.id}
                    className={`flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-5 py-3.5 last:border-0 ${
                      p.estado === "listo" ? "" : "opacity-80"
                    }`}
                  >
                    <div className="min-w-[14rem] flex-1">
                      <Link href={`/admin/pedidos/${p.id}`} className="text-base font-medium hover:text-brand-orange">
                        {p.cliente}
                      </Link>
                      <p className="text-base text-muted-foreground">{p.direccionEntrega ?? "Sin dirección"}</p>
                    </div>
                    <span className="tabular text-base text-muted-foreground">{p.numero}</span>
                    <EtiquetaEstado estado={p.estado} contexto="pedido" />
                    {p.estadoPago !== "pagado" && (
                      <EtiquetaEstado estado={p.estadoPago} contexto="pago" />
                    )}
                    <span className="tabular w-28 text-right text-base font-medium">{moneda.format(p.total)}</span>
                    <AccionesPedido
                      id={p.id}
                      estado={p.estado}
                      estadoPago={p.estadoPago}
                      tipoEntrega={p.tipoEntrega}
                    />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
