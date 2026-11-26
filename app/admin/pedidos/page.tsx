import Link from "next/link";
import { Package, Truck } from "lucide-react";
import { EncabezadoPanel } from "@/components/admin/encabezado";
import {
  ColumnaTablero,
  TarjetaTablero,
  Tablero,
} from "@/components/admin/kanban";
import { haceCuanto, moneda, plural } from "@/components/admin/formato";
import { cantidadConUnidad } from "@/lib/formato";
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
  { estado: "pendiente", titulo: "Sin preparar" },
  { estado: "preparando", titulo: "Preparando" },
  { estado: "listo", titulo: "Listos" },
  { estado: "en-camino", titulo: "En camino" },
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

  // El entregado sin cobrar sigue en curso (Go lo trae aunque tenga más de
  // una semana): con su tarjeta y su «Cobrar», como los listos (H367).
  const entregadosSinCobrar = pedidos.filter((p) => p.estado === "entregado" && (p.sinCobrar ?? 0) > 0.009);
  // Lo cerrado en la semana: lo entregado (y cobrado) y lo cancelado, cada uno marcado.
  const entregados = pedidos.filter(
    (p) => (p.estado === "entregado" && !((p.sinCobrar ?? 0) > 0.009)) || p.estado === "cancelado",
  );
  const activos = pedidos.filter(
    (p) => !["entregado", "cancelado"].includes(p.estado),
  );
  // Lo que falta cobrar con la regla de «Me deben» (sinCobrar, de Go): sin
  // los pedidos a cuenta corriente, que ya están en la cuenta, y descontando
  // lo cobrado. Sumar el total de todo lo no pagado daba un tercer número.
  const porCobrar = activos.reduce((s, p) => s + (p.sinCobrar ?? 0), 0);

  return (
    <div>
      <EncabezadoPanel
        titulo="Pedidos"
        resumen={
          activos.length > 0
            ? // «Por cobrar» es lo de los pedidos en curso, la suma de las
              // etiquetas «Sin cobrar» de las tarjetas; «Me deben» del
              // inicio cuenta lo que ya salió (mes simulado: decían «sin
              // cobrar» los dos con números distintos).
              `${plural(activos.length, "pedido")} en curso${porCobrar > 0 ? ` · ${moneda.format(porCobrar)} por cobrar` : ""}`
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
                >
                  {enColumna.map((pedido) => (
                    <TarjetaPedido key={pedido.id} pedido={pedido} aviso={avisos[pedido.id] ?? null} cobra={cobra} />
                  ))}
                </ColumnaTablero>
              );
            })}
          </Tablero>

          {entregadosSinCobrar.length > 0 && (
            <section className="mt-8">
              <h2 className="mb-2.5 text-base font-semibold">
                Entregados sin cobrar{" "}
                <span className="tabular estado-problema">
                  {moneda.format(entregadosSinCobrar.reduce((s, p) => s + (p.sinCobrar ?? 0), 0))}
                </span>
              </h2>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {entregadosSinCobrar.map((pedido) => (
                  <TarjetaPedido key={pedido.id} pedido={pedido} aviso={avisos[pedido.id] ?? null} cobra={cobra} />
                ))}
              </div>
            </section>
          )}

          {entregados.length > 0 && (
            <section className="mt-8">
              <h2 className="mb-2.5 text-base font-semibold text-muted-foreground">
                Cerrados esta semana
              </h2>
              <ul className="overflow-hidden tarjeta">
                {entregados.slice(0, 10).map((p) => (
                  <FilaCerrada key={p.id} pedido={p} fecha={haceCuanto(p.createdAt)} />
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
  const [filas, dueno, sucursales] = await Promise.all([
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
    listarSucursalesPublicas(),
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

      {/* El mismo buscador de En curso: el historial es una lista larga y el
          número es lo que dice el cliente (mes simulado). */}
      <BuscadorPedidos
        busquedaActual={params.buscar ?? ""}
        sucursalActual={params.sucursal ?? "todas"}
        sucursales={sucursales.map((s) => ({ slug: s.slug, nombre: s.nombre }))}
      />

      <div className="mb-4 mt-4 flex flex-wrap gap-x-5 gap-y-2">
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
            <FilaCerrada
              key={p.id}
              pedido={p}
              // Sin cobrar, lo que importa es cuánto hace que se entregó.
              fecha={
                sinCobrar && p.entregadoAt
                  ? haceCuanto(p.entregadoAt)
                  : p.createdAt.toLocaleDateString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" })
              }
              urgente={sinCobrar && Boolean(p.entregadoAt)}
              monto={estado === "sin-cobrar" && p.sinCobrar != null ? p.sinCobrar : undefined}
            />
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

/**
 * Un pedido cerrado, en una fila que se toca entera (el número incluido: es
 * lo que dice el cliente). El nombre va en su renglón y debajo el número, la
 * fecha, el estado y el monto: a 375 px el número se montaba sobre el nombre
 * (mes simulado).
 */
function FilaCerrada({
  pedido: p,
  fecha,
  urgente = false,
  monto,
}: {
  pedido: PedidoListado;
  fecha: string;
  urgente?: boolean;
  /** Lo que falta cobrar, en el filtro «Sin cobrar». */
  monto?: number;
}) {
  const interno = p.comprobante === "interno" && !p.facturado && p.estado !== "cancelado";
  return (
    <li className="border-b last:border-0">
      <Link href={`/admin/pedidos/${p.id}`} className="block px-5 py-3.5 transition-colors hover:bg-hundida/60">
        <span className="block truncate text-base font-medium">
          {p.cliente}
          {p.empresa && <span className="font-normal text-muted-foreground"> · {p.empresa}</span>}
        </span>
        <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="codigo">{p.numero}</span>
          <span className={`text-base ${urgente ? "estado-problema" : "text-muted-foreground"}`}>{fecha}</span>
          <EtiquetaEstado estado={p.estado} contexto="pedido" />
          {interno && (
            <span className="estado-cerrado rounded-full bg-[var(--estado-fondo)] px-2.5 py-1 text-sm font-medium">Interno</span>
          )}
          <span
            className={`tabular ml-auto text-base ${monto != null ? "estado-problema font-semibold" : "font-medium"} ${
              p.estado === "cancelado" ? "text-muted-foreground line-through" : ""
            }`}
          >
            {moneda.format(monto ?? p.total)}
          </span>
        </span>
      </Link>
    </li>
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
          {pedido.sucursal ? `Retira en ${pedido.sucursal}` : "Retira en el local"}
        </p>
      )}

      {/* Lo que falta de un pedido que ya salió en parte: el segundo viaje o
          el próximo retiro del acopio (mes simulado: se veía el total, como
          si no hubiera salido nada). */}
      {pedido.porEntregar.length > 0 && (
        <ul className="mt-2 space-y-0.5 rounded-md bg-hundida px-2 py-1.5 text-sm">
          {pedido.porEntregar.slice(0, 3).map((r, i) => (
            <li key={i} className="flex justify-between gap-2">
              <span className="truncate text-muted-foreground">{r.descripcion}</span>
              <span className="tabular shrink-0 font-medium">{cantidadConUnidad(r.pendiente, r.unidad, r.descripcion)}</span>
            </li>
          ))}
          {pedido.porEntregar.length > 3 && (
            <li className="text-muted-foreground">{plural(pedido.porEntregar.length - 3, "renglón más", "renglones más")}</li>
          )}
        </ul>
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
          pedido={{ numero: pedido.numero, nombre: pedido.cliente }}
          cobro={cobra ? cobroDelPedido(pedido) : null}
          sinCobrar={pedido.sinCobrar ? { numero: pedido.numero, monto: pedido.sinCobrar } : null}
          cortesSinTerminar={pedido.cortesSinTerminar}
          acopio={pedido.acopio}
          porLlevar={pedido.porEntregar.length > 0}
          compacto
        />
      </div>
    </TarjetaTablero>
  );
}
