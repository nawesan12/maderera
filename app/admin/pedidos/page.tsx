import Link from "next/link";
import { Package, Truck } from "lucide-react";
import { EncabezadoPanel } from "@/components/admin/encabezado";
import {
  ColumnaTablero,
  TarjetaTablero,
  Tablero,
} from "@/components/admin/kanban";
import { haceCuanto, moneda, plural } from "@/components/admin/formato";
import { diasDesde } from "@/lib/formato";
import { BuscadorPedidos } from "./buscador";
import { listarPedidos, type PedidoListado } from "@/lib/dal/admin/ventas";
import { AvisarPorWhatsapp } from "@/components/admin/avisar-por-whatsapp";
import { requireStaff } from "@/lib/dal/session";
import { MANEJAN_PLATA, puedeEntrar } from "@/lib/roles";
import { cobroDelPedido } from "./cobro";
import { avisosManuales, type AvisoManualListo } from "@/lib/whatsapp/aviso-manual-datos";
import { numerosDelDueno } from "@/lib/dal/admin/resumen";
import { listarSucursalesPublicas } from "@/lib/dal/envios";
import { AccionesPedido } from "./acciones";
import { EtiquetaEstado } from "@/components/admin/etiqueta-estado";

/** Las etapas por las que pasa un pedido, en orden. */
const COLUMNAS = [
  { estado: "pendiente", titulo: "Sin preparar", vacio: "Nada esperando." },
  { estado: "preparando", titulo: "Preparando", vacio: "Nada en preparación." },
  { estado: "listo", titulo: "Listos", vacio: "Nada listo todavía." },
  { estado: "en-camino", titulo: "En camino", vacio: "Ningún envío en la calle." },
] as const;

export default async function PedidosPage({
  searchParams,
}: {
  searchParams: Promise<{ buscar?: string; sucursal?: string; ver?: string; periodo?: string; estado?: string; pagina?: string }>;
}) {
  const params = await searchParams;
  if (params.ver === "historial") return <Historial params={params} />;
  const [pedidos, sucursales] = await Promise.all([
    listarPedidos({ busqueda: params.buscar, sucursal: params.sucursal, vista: params.buscar ? undefined : "tablero" }),
    listarSucursalesPublicas(),
  ]);

  // En «listo» y «en camino» el cliente tiene que enterarse: el botón gratis
  // va en la tarjeta, sin entrar al pedido.
  // Solo para quien atiende el WhatsApp de la maderera (no depósito).
  const { staffRole: rol } = await requireStaff();
  const atiende = puedeEntrar("/admin/whatsapp", rol);
  // El depósito abre el tablero pero no cobra (MANEJAN_PLATA).
  const cobra = rol != null && MANEJAN_PLATA.includes(rol);
  const [avisosListo, avisosEnCamino] = atiende
    ? await Promise.all([
        avisosManuales("listo", "order", pedidos.filter((p) => p.estado === "listo").map((p) => p.id)),
        avisosManuales("en-camino", "order", pedidos.filter((p) => p.estado === "en-camino").map((p) => p.id)),
      ])
    : [{}, {}];
  const avisos = { ...avisosListo, ...avisosEnCamino };

  const entregados = pedidos.filter((p) => p.estado === "entregado");
  const activos = pedidos.filter(
    (p) => !["entregado", "cancelado"].includes(p.estado),
  );
  // Lo que falta cobrar con la regla de «Me deben» (sinCobrar, de Go): sin
  // los pedidos a cuenta corriente, que ya están en la cuenta, y descontando
  // lo cobrado. Sumar el total de todo lo no pagado daba un tercer número.
  const porCobrar = pedidos.reduce((s, p) => s + (p.sinCobrar ?? 0), 0);

  return (
    <div>
      <EncabezadoPanel
        titulo="Pedidos"
        resumen={
          activos.length > 0
            ? `${plural(activos.length, "pedido")} en curso${porCobrar > 0 ? ` · ${moneda.format(porCobrar)} sin cobrar` : ""}`
            : `${plural(pedidos.length, "pedido")} en total`
        }
      />

      <VistasDePedidos actual="curso" />

      <BuscadorPedidos
        busquedaActual={params.buscar ?? ""}
        sucursalActual={params.sucursal ?? "todas"}
        sucursales={sucursales.map((s) => ({
          slug: s.slug,
          nombre: s.nombre,
        }))}
      />

      {pedidos.length === 0 ? (
        <div className="mt-6 rounded-xl border border-dashed py-16 text-center">
          <Package className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
          <p className="text-base font-medium">No hay pedidos que mostrar</p>
        </div>
      ) : (
        <>
          <Tablero>
            {COLUMNAS.map((columna) => {
              const enColumna = pedidos.filter(
                (p) => p.estado === columna.estado,
              );
              const monto = enColumna.reduce((s, p) => s + p.total, 0);

              return (
                <ColumnaTablero
                  key={columna.estado}
                  titulo={columna.titulo}
                  cantidad={enColumna.length}
                  detalle={
                    enColumna.length > 0 ? moneda.format(monto) : undefined
                  }
                  estado={columna.estado}
                  vacio={columna.vacio}
                >
                  {enColumna.map((pedido) => (
                    <TarjetaPedido key={pedido.id} pedido={pedido} aviso={avisos[pedido.id] ?? null} cobra={cobra} />
                  ))}
                </ColumnaTablero>
              );
            })}
          </Tablero>

          {entregados.length > 0 && (
            <section className="mt-8">
              <h2 className="mb-2.5 text-base font-semibold text-muted-foreground">
                Cerrados esta semana
              </h2>
              <ul className="overflow-hidden tarjeta">
                {entregados.slice(0, 10).map((p) => (
                  <li
                    key={p.id}
                    className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b px-5 py-3.5 last:border-0"
                  >
                    <Link
                      href={`/admin/pedidos/${p.id}`}
                      className="min-w-0 flex-1 text-base hover:text-brand-orange"
                    >
                      {p.cliente}
                    </Link>
                    <span className="codigo">
                      {p.numero}
                    </span>
                    <span className="text-base text-muted-foreground">
                      {haceCuanto(p.createdAt)}
                    </span>
                    <span className="tabular text-base font-medium">
                      {moneda.format(p.total)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}

/** En curso o el historial: lo que se atiende y lo que ya pasó. */
function VistasDePedidos({ actual }: { actual: "curso" | "historial" }) {
  const clase = (activa: boolean) =>
    `inline-flex h-10 items-center rounded-lg px-4 text-base font-medium ${
      activa ? "bg-foreground text-background" : "bg-hundida text-muted-foreground hover:text-foreground"
    }`;
  return (
    <nav aria-label="Ver pedidos" className="mb-4 flex gap-2">
      <Link href="/admin/pedidos" className={clase(actual === "curso")} aria-current={actual === "curso" ? "page" : undefined}>
        En curso
      </Link>
      <Link
        href="/admin/pedidos?ver=historial"
        className={clase(actual === "historial")}
        aria-current={actual === "historial" ? "page" : undefined}
      >
        Historial
      </Link>
    </nav>
  );
}

const PERIODOS: Record<string, { texto: string; dias: number | null }> = {
  "30": { texto: "Últimos 30 días", dias: 30 },
  "90": { texto: "Últimos 90 días", dias: 90 },
  "365": { texto: "Último año", dias: 365 },
  todo: { texto: "Todo", dias: null },
};

/** El día de hace `dias` días, en Argentina, como AAAA-MM-DD. */
function haceDias(dias: number): string {
  return new Date(Date.now() - dias * 86_400_000).toLocaleDateString("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
  });
}

// «Sin cobrar» es a donde lleva el renglón de «Me deben»: lo entregado a lo
// que le falta cobrar, el más viejo primero (lo ordena Go).
const ESTADOS_HISTORIAL: Record<string, string> = {
  todos: "Todos",
  entregado: "Entregados",
  "sin-cobrar": "Sin cobrar",
  cancelado: "Cancelados",
};

/**
 * Lo cerrado, de a 50. El tablero mostraba solo los últimos seis entregados:
 * un pedido de hace un mes no había forma de encontrarlo sin saber el número.
 */
async function Historial({
  params,
}: {
  params: { buscar?: string; sucursal?: string; periodo?: string; estado?: string; pagina?: string };
}) {
  const estado = params.estado && params.estado in ESTADOS_HISTORIAL ? params.estado : "todos";
  /*
   * «Sin cobrar» es desde siempre y del más viejo al más nuevo, como «Me
   * deben», que es de donde se llega: con el período de 30 días la lista
   * mostraba menos de lo que sumaba la tarjeta. El período no se elige.
   */
  const sinCobrar = estado === "sin-cobrar";
  const periodo = sinCobrar ? "todo" : params.periodo && params.periodo in PERIODOS ? params.periodo : "30";
  const pagina = Math.max(1, Number(params.pagina) || 1);
  const dias = PERIODOS[periodo].dias;
  const desde = dias ? haceDias(dias) : undefined;

  const { staffRole } = await requireStaff();
  const [filas, dueno] = await Promise.all([
    listarPedidos({
      vista: "historial",
      busqueda: params.buscar,
      sucursal: params.sucursal,
      estado: estado === "todos" ? undefined : estado,
      desde,
      pagina,
    }),
    // El total, el mismo número del renglón de «Me deben» (solo lo ve el
    // admin, como la tarjeta).
    sinCobrar && staffRole === "admin" ? numerosDelDueno() : null,
  ]);
  const totalSinCobrar = dueno?.meDeben.pedidosSinCobrar;
  const hayMas = filas.length > 50;
  const visibles = filas.slice(0, 50);
  const enlace = (cambios: Record<string, string | number | undefined>) => {
    const q = new URLSearchParams({ ver: "historial" });
    const base = { periodo, estado, buscar: params.buscar, sucursal: params.sucursal, ...cambios };
    for (const [k, v] of Object.entries(base)) {
      if (v === undefined || v === "" || (k === "pagina" && Number(v) === 1)) continue;
      q.set(k, String(v));
    }
    return `/admin/pedidos?${q}`;
  };

  return (
    <div>
      <EncabezadoPanel
        titulo="Pedidos"
        resumen={
          totalSinCobrar && totalSinCobrar.cantidad > 0
            ? `${moneda.format(totalSinCobrar.total)} en ${plural(totalSinCobrar.cantidad, "pedido sin cobrar", "pedidos sin cobrar")}`
            : "Historial"
        }
      />
      <VistasDePedidos actual="historial" />

      <div className="mb-4 flex flex-wrap gap-x-5 gap-y-2">
        <div className={`flex flex-wrap gap-1.5 ${sinCobrar ? "hidden" : ""}`} role="group" aria-label="Período">
          {Object.entries(PERIODOS).map(([valor, p]) => (
            <Link
              key={valor}
              href={enlace({ periodo: valor, pagina: undefined })}
              aria-current={valor === periodo ? "true" : undefined}
              className={`inline-flex h-10 items-center rounded-full px-4 text-base ${
                valor === periodo ? "bg-foreground text-background" : "bg-hundida text-muted-foreground hover:text-foreground"
              }`}
            >
              {p.texto}
            </Link>
          ))}
        </div>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Estado">
          {Object.entries(ESTADOS_HISTORIAL).map(([valor, texto]) => (
            <Link
              key={valor}
              href={enlace({ estado: valor, pagina: undefined })}
              aria-current={valor === estado ? "true" : undefined}
              className={`inline-flex h-10 items-center rounded-full px-4 text-base ${
                valor === estado ? "bg-foreground text-background" : "bg-hundida text-muted-foreground hover:text-foreground"
              }`}
            >
              {texto}
            </Link>
          ))}
        </div>
      </div>

      {visibles.length === 0 ? (
        <p className="tarjeta-hundida rounded-xl px-5 py-10 text-center text-base text-muted-foreground">
          Nada en ese período.
        </p>
      ) : (
        <ul className="tarjeta overflow-hidden">
          {visibles.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b px-5 py-3.5 last:border-0">
              <Link href={`/admin/pedidos/${p.id}`} className="min-w-0 flex-1 text-base hover:text-brand-orange">
                {p.cliente}
                {p.empresa && <span className="text-muted-foreground"> · {p.empresa}</span>}
              </Link>
              <span className="codigo">{p.numero}</span>
              {/* Sin cobrar, lo que importa es cuánto hace que se entregó. */}
              {sinCobrar && p.entregadoAt ? (
                <span className="estado-problema text-base">{haceCuanto(p.entregadoAt)}</span>
              ) : (
                <span className="text-base text-muted-foreground">
                  {p.createdAt.toLocaleDateString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" })}
                </span>
              )}
              <EtiquetaEstado estado={p.estado} contexto="pedido" />
              {estado === "sin-cobrar" && p.sinCobrar != null ? (
                <span className="tabular estado-problema w-32 text-right text-base font-semibold">{moneda.format(p.sinCobrar)}</span>
              ) : (
                <span className="tabular w-32 text-right text-base font-medium">{moneda.format(p.total)}</span>
              )}
            </li>
          ))}
        </ul>
      )}

      {(pagina > 1 || hayMas) && (
        <div className="mt-4 flex justify-between">
          {pagina > 1 ? (
            <Link href={enlace({ pagina: pagina - 1 })} className="inline-flex h-11 items-center rounded-lg bg-hundida px-4 text-base">
              {/* «Sin cobrar» va del más viejo al más nuevo: al revés. */}
              {sinCobrar ? "Más viejos" : "Más nuevos"}
            </Link>
          ) : (
            <span />
          )}
          {hayMas && (
            <Link href={enlace({ pagina: pagina + 1 })} className="inline-flex h-11 items-center rounded-lg bg-hundida px-4 text-base">
              {sinCobrar ? "Más nuevos" : "Más viejos"}
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

function TarjetaPedido({ pedido, aviso, cobra }: { pedido: PedidoListado; aviso: AvisoManualListo | null; cobra: boolean }) {
  // La misma regla que «Me deben»: un pedido a cuenta corriente no se cobra
  // en la puerta.
  const sinCobrar = pedido.sinCobrar != null;
  // Un pedido que lleva más de dos días sin prepararse avisa solo.
  const demorado =
    ["pendiente", "preparando"].includes(pedido.estado) && diasDesde(pedido.createdAt) > 2;

  return (
    <TarjetaTablero destacada={(sinCobrar && pedido.estado === "listo") || demorado}>
      <div className="flex items-start justify-between gap-2">
        <Link
          href={`/admin/pedidos/${pedido.id}`}
          className="text-base font-medium leading-snug hover:text-brand-orange"
        >
          {pedido.cliente}
        </Link>
        <span className="codigo shrink-0">
          {pedido.numero}
        </span>
      </div>

      {pedido.empresa && (
        <p className="text-sm text-muted-foreground">{pedido.empresa}</p>
      )}

      <p className="tabular mt-2 text-lg font-semibold">
        {moneda.format(pedido.total)}
      </p>

      <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-sm text-muted-foreground">
        <span>{plural(pedido.items, "producto")}</span>
        <span aria-hidden="true">·</span>
        <span className={demorado ? "estado-problema font-medium" : ""}>{haceCuanto(pedido.createdAt)}</span>
      </p>

      {pedido.tipoEntrega === "envio" ? (
        <p className="mt-2 flex items-start gap-1.5 rounded-md bg-muted/60 px-2 py-1.5 text-sm text-muted-foreground">
          <Truck className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="line-clamp-2">
            {pedido.direccionEntrega ?? "Envío a domicilio"}
          </span>
        </p>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">
          Retira en {pedido.sucursal}
        </p>
      )}

      {sinCobrar && (
        <p className="estado-espera mt-2 inline-flex self-start rounded-full bg-[var(--estado-fondo)] px-2 py-0.5 text-sm font-medium text-[var(--estado-tinta)]">
          Sin cobrar
        </p>
      )}

      {aviso && (
        <div className="mt-3">
          <AvisarPorWhatsapp aviso={aviso} compacto />
        </div>
      )}

      <div className="mt-auto border-t pt-3">
        <AccionesPedido
          id={pedido.id}
          estado={pedido.estado}
          estadoPago={pedido.estadoPago}
          tipoEntrega={pedido.tipoEntrega}
          cobro={cobra ? cobroDelPedido(pedido) : null}
          sinCobrar={pedido.sinCobrar ? { numero: pedido.numero, monto: pedido.sinCobrar } : null}
          compacto
        />
      </div>
    </TarjetaTablero>
  );
}
