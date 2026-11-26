import Link from "next/link";
import { Banknote, CalendarDays, Landmark, MapPin, Truck } from "lucide-react";
import { EncabezadoPanel } from "@/components/admin/encabezado";
import { EtiquetaEstado } from "@/components/admin/etiqueta-estado";
import { moneda, plural } from "@/components/admin/formato";
import { cantidadConUnidad } from "@/lib/formato";
import { listarPedidos, type PedidoListado } from "@/lib/dal/admin/ventas";
import { listarZonasDeEnvio } from "@/lib/dal/envios";
import { requireStaff } from "@/lib/dal/session";
import { AccionesPedido } from "../pedidos/acciones";
import { cobroDelPedido } from "../pedidos/cobro";
import { MANEJAN_PLATA } from "@/lib/roles";

export const metadata = { title: "Reparto" };

const SIN_ZONA = "Sin zona";

const MEDIO: Record<string, string> = {
  efectivo: "Efectivo",
  transferencia: "Transferencia",
  debito: "Débito",
  credito: "Crédito",
  mercado_pago: "Mercado Pago",
  cheque: "Cheque",
};

/** «Vie 28/11», en hora argentina. */
const diaCorto = new Intl.DateTimeFormat("es-AR", {
  weekday: "short",
  day: "2-digit",
  month: "2-digit",
  timeZone: "UTC",
});

/**
 * El reparto: lo que hay que llevar, por zona y por día.
 *
 * Los envíos estaban mezclados en el tablero de pedidos con lo que se retira,
 * y para armar el viaje del camión había que leer cada tarjeta. Acá van solos,
 * agrupados por zona de reparto y, dentro de cada una, del día comprometido
 * más cercano al más lejano (mes simulado: el envío del 28/11 aparecía último
 * y ninguna tarjeta decía la fecha). Cada tarjeta dice de qué sucursal sale,
 * qué falta llevar si ya salió una parte, y cuánto cobrar y en qué medio: el
 * chofer tiene que saber si vuelve con plata.
 */
export default async function RepartoPage() {
  const { staffRole } = await requireStaff();
  // El depósito reparte pero no cobra (MANEJAN_PLATA).
  const cobra = staffRole != null && MANEJAN_PLATA.includes(staffRole);
  const [todos, zonasDeEnvio] = await Promise.all([listarPedidos({ vista: "tablero" }), listarZonasDeEnvio()]);
  const pedidos = todos.filter((p) => p.tipoEntrega === "envio" && !["entregado", "cancelado"].includes(p.estado));

  // Solo las zonas de reparto configuradas agrupan: un texto suelto («Mar del
  // Plata», la ciudad) no le sirve al chofer para armar el recorrido.
  const deReparto = new Map(zonasDeEnvio.map((z) => [z.nombre.trim().toLowerCase(), z.nombre]));
  const zonaDe = (p: PedidoListado) => deReparto.get(p.zonaEnvio?.trim().toLowerCase() ?? "") ?? SIN_ZONA;

  const porZona = new Map<string, PedidoListado[]>();
  for (const p of pedidos) {
    const zona = zonaDe(p);
    porZona.set(zona, [...(porZona.get(zona) ?? []), p]);
  }
  const ORDEN: Record<string, number> = { listo: 0, preparando: 1, pendiente: 2, "en-camino": 3 };
  // Primero el día (sin día, al final); a igual día, lo listo para cargar.
  const enOrden = (a: PedidoListado, b: PedidoListado) =>
    (a.entregarEl ?? "9999").localeCompare(b.entregarEl ?? "9999") || (ORDEN[a.estado] ?? 9) - (ORDEN[b.estado] ?? 9);
  const zonas = [...porZona.entries()]
    .map(([zona, ps]) => ({ zona, pedidos: ps.sort(enOrden) }))
    .sort((a, b) =>
      a.zona === SIN_ZONA ? 1 : b.zona === SIN_ZONA ? -1 : enOrden(a.pedidos[0], b.pedidos[0]),
    );

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
              <h2 className="mb-2.5 flex flex-wrap items-baseline gap-x-2 text-lg font-semibold">
                <MapPin
                  className={`h-5 w-5 self-center ${zona === SIN_ZONA ? "text-muted-foreground" : "text-brand-orange"}`}
                  aria-hidden="true"
                />
                {zona}
                <span className="text-base font-normal text-muted-foreground">
                  {plural(ps.length, "pedido")} · {moneda.format(ps.reduce((s, p) => s + p.total, 0))}
                </span>
              </h2>
              <ul className="tarjeta overflow-hidden">
                {ps.map((p) => (
                  <FilaDeReparto key={p.id} pedido={p} cobra={cobra} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function FilaDeReparto({ pedido: p, cobra }: { pedido: PedidoListado; cobra: boolean }) {
  const efectivo = p.medioPago === "efectivo";
  return (
    <li className={`space-y-2 border-b px-5 py-4 last:border-0 ${p.estado === "listo" ? "" : "opacity-80"}`}>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
        <div className="min-w-0 flex-1 basis-56">
          <Link href={`/admin/pedidos/${p.id}`} className="text-base font-medium hover:text-brand-orange">
            {p.cliente}
          </Link>
          <p className="text-base text-muted-foreground">{p.direccionEntrega ?? "Sin dirección"}</p>
        </div>
        {/* El día comprometido manda: el estado es el mismo en casi todas. */}
        {p.entregarEl ? (
          <span className="inline-flex items-center gap-1.5 text-base font-semibold">
            <CalendarDays className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            {diaCorto.format(new Date(`${p.entregarEl}T12:00:00Z`))}
          </span>
        ) : (
          <EtiquetaEstado estado={p.estado} contexto="pedido" />
        )}
      </div>

      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
        <span className="codigo">{p.numero}</span>
        {p.sucursal && <span>Sale de {p.sucursal}</span>}
        {p.entregarEl && <EtiquetaEstado estado={p.estado} contexto="pedido" />}
      </p>

      {/* Ya salió una parte: lo que lleva el próximo viaje. */}
      {p.porEntregar.length > 0 && (
        <ul className="space-y-0.5 rounded-md bg-hundida px-3 py-2 text-base">
          {p.porEntregar.map((r, i) => (
            <li key={i} className="flex justify-between gap-3">
              <span className="min-w-0 truncate">{r.descripcion}</span>
              <span className="tabular shrink-0 font-semibold">{cantidadConUnidad(r.pendiente, r.unidad, r.descripcion)}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* Un solo importe: lo que hay que traer de vuelta si falta cobrar,
            con el medio al lado (el chofer vuelve con efectivo o no), y si
            no, el total. Una transferencia informada no se reclama otra vez. */}
        {p.pagoEnRevision ? (
          <EtiquetaEstado estado="en_revision" contexto="pago" />
        ) : p.sinCobrar != null ? (
          <span className={`inline-flex items-center gap-1.5 text-base font-semibold ${efectivo ? "estado-espera" : ""}`}>
            {efectivo ? (
              <Banknote className="h-5 w-5" aria-hidden="true" />
            ) : (
              <Landmark className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
            )}
            <span className="tabular">{moneda.format(p.sinCobrar)}</span>
            <span className="font-normal">{p.medioPago ? (MEDIO[p.medioPago] ?? p.medioPago) : "A cobrar"}</span>
          </span>
        ) : (
          <span className="tabular text-base font-medium text-muted-foreground">
            {moneda.format(p.total)}
            {p.estadoPago === "pagado" && " · pagado"}
          </span>
        )}
        {/* Con `cobro`, el botón «Cobrar» de verdad y el diálogo de la
            entrega con «Cobrar y entregar»: el chofer vuelve con la plata y
            se anota acá. Sin eso «Me deben» crecía solo. */}
        <AccionesPedido
          id={p.id}
          estado={p.estado}
          estadoPago={p.estadoPago}
          tipoEntrega={p.tipoEntrega}
          pedido={{ numero: p.numero, nombre: p.cliente }}
          cobro={cobra && p.sinCobrar != null ? cobroDelPedido(p) : null}
          sinCobrar={p.sinCobrar != null ? { numero: p.numero, monto: p.sinCobrar } : null}
          cortesSinTerminar={p.cortesSinTerminar}
          porLlevar={p.porEntregar.length > 0}
        />
      </div>
    </li>
  );
}
