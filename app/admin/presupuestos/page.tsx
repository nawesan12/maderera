import Link from "next/link";
import { redirect } from "next/navigation";
import { CalendarClock, ChevronRight, ClipboardList, Plus, ShoppingCart, Timer } from "lucide-react";
import { EncabezadoPanel } from "@/components/admin/encabezado";
import { Button } from "@/components/ui/button";
import {
  AcentoEstado,
  EtiquetaEstado,
} from "@/components/admin/etiqueta-estado";
import { FiltroEstado } from "@/components/admin/filtro-estado";
import { GrupoListado } from "@/components/admin/grupo";
import {
  leerPagina,
  Paginador,
  POR_PAGINA,
} from "@/components/admin/paginador";
import {
  fechaCorta,
  formatearMonto,
  haceCuanto,
  plural,
} from "@/components/admin/formato";
import {
  listarPresupuestos,
  type PresupuestoListado,
} from "@/lib/dal/admin/ventas";
import { listarSucursalesPublicas } from "@/lib/dal/envios";

const ESTADOS = {
  todos: "Todos",
  // Los tres que todavía esperan algo, juntos. Es a donde lleva la tarjeta
  // "Presupuestos abiertos" del resumen.
  abiertos: "Abiertos",
  pendiente: "Pendientes",
  revision: "En revisión",
  enviado: "Enviados",
  aceptado: "Aceptados",
  // A donde lleva «presupuestos aceptados sin pedido» del inicio.
  "sin-pedido": "Sin pedido",
  rechazado: "Rechazados",
  cerrados: "Cerrados",
};

/** Los estados que todavía esperan algo (el «abiertos» de Go). */
const ABIERTOS = new Set(["abiertos", "pendiente", "revision", "enviado", "sin-pedido"]);

const ORIGEN: Record<string, string> = {
  sitio: "Pedido desde el sitio",
  calculadora: "Armado con la calculadora",
  mostrador: "Mostrador",
  telefono: "Por teléfono",
  express: "Express de un profesional",
  whatsapp: "Por WhatsApp",
};



/**
 * Los presupuestos, de a páginas (tanda T8): se acumulan sin tope y la
 * pantalla los traía todos.
 *
 * Sin filtro de estado se piden dos listas, cada una de a 30 y con su propio
 * parámetro de página: lo que espera respuesta (`espera`), por urgencia, y
 * los cerrados (`pagina`), del más nuevo al más viejo. «Esperando respuesta»
 * venía entero con el argumento de que son pocos, y no lo eran: los enviados
 * sin contestar se juntaban para siempre (ahora la tarea diaria los vence).
 * Con un estado elegido, una sola lista paginada. Las cantidades y la plata
 * del encabezado son de todos, no de la página: las suma Go.
 */
export default async function PresupuestosPage({
  searchParams,
}: {
  searchParams: Promise<{
    buscar?: string;
    estado?: string;
    sucursal?: string;
    pagina?: string;
    espera?: string;
  }>;
}) {
  const params = await searchParams;
  const pagina = leerPagina(params.pagina);
  const estado = params.estado && params.estado !== "todos" ? params.estado : undefined;
  const filtros = { busqueda: params.buscar, sucursal: params.sucursal };
  const dosListas = estado === undefined;
  // Con las dos listas, la de «Esperando respuesta» va por `espera`.
  const paginaAbiertos = dosListas ? leerPagina(params.espera) : pagina;
  const de = (n: number) => ({ limite: POR_PAGINA, desplazamiento: (n - 1) * POR_PAGINA });

  const [abiertos, cerrados, sucursales] = await Promise.all([
    dosListas || ABIERTOS.has(estado)
      ? listarPresupuestos({ ...filtros, estado: estado ?? "abiertos" }, de(paginaAbiertos))
      : null,
    dosListas || !ABIERTOS.has(estado)
      ? listarPresupuestos({ ...filtros, estado: estado ?? "cerrados" }, de(pagina))
      : null,
    listarSucursalesPublicas(),
  ]);

  // Una página que se pasó del final (un enlace viejo, un filtro que achicó
  // la lista) lleva a la última que existe, en cada lista.
  const ultima = (l: { total: number } | null) => Math.max(1, Math.ceil((l?.total ?? 0) / POR_PAGINA));
  const deMas = (l: { total: number; filas: unknown[] } | null, n: number) =>
    l !== null && l.filas.length === 0 && l.total > 0 && n > ultima(l);
  const listaDePagina = cerrados ?? abiertos;
  if (deMas(listaDePagina, pagina) || (dosListas && deMas(abiertos, paginaAbiertos))) {
    const q = new URLSearchParams(
      Object.entries({ buscar: params.buscar, estado: params.estado, sucursal: params.sucursal }).filter(
        (e): e is [string, string] => Boolean(e[1]),
      ),
    );
    const p = Math.min(pagina, ultima(listaDePagina));
    if (p > 1) q.set("pagina", String(p));
    if (dosListas) {
      const e = Math.min(paginaAbiertos, ultima(abiertos));
      if (e > 1) q.set("espera", String(e));
    }
    redirect(`/admin/presupuestos${q.size > 0 ? `?${q}` : ""}`);
  }

  const total = (abiertos?.total ?? 0) + (cerrados?.total ?? 0);
  const vigentes = {
    buscar: params.buscar,
    estado: params.estado,
    sucursal: params.sucursal,
    pagina: pagina > 1 ? String(pagina) : undefined,
    espera: dosListas && paginaAbiertos > 1 ? String(paginaAbiertos) : undefined,
  };
  const paginador = (
    <Paginador pagina={pagina} total={listaDePagina?.total ?? 0} params={vigentes} />
  );

  return (
    <div>
      <EncabezadoPanel
        titulo="Presupuestos"
        resumen={
          abiertos && abiertos.total > 0
            ? `${plural(abiertos.total, "presupuesto")} por atender por ${formatearMonto(abiertos.monto)}`
            : `${plural(total, "presupuesto")} en total`
        }
      >
        {/* Lo que entra por teléfono se carga acá: hasta ahora un presupuesto
            solo podía nacer del sitio. */}
        <Button render={<Link href="/admin/presupuestos/nuevo" />}>
          <Plus className="h-4 w-4" />
          Nuevo presupuesto
        </Button>
      </EncabezadoPanel>

      <FiltroEstado
        ruta="/admin/presupuestos"
        estados={ESTADOS}
        estadoActual={params.estado ?? "todos"}
        busquedaActual={params.buscar ?? ""}
        placeholder="Buscar por número, cliente o empresa…"
        extra={{
          parametro: "sucursal",
          etiqueta: "Filtrar por sucursal",
          // De la base: una sucursal nueva aparece sola.
          opciones: { todos: "Todas", ...Object.fromEntries(sucursales.map((x) => [x.slug, x.nombre])) },
          actual: params.sucursal ?? "todos",
        }}
      />

      {total === 0 ? (
        <div className="mt-6 rounded-xl border border-dashed py-16 text-center">
          <ClipboardList className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
          <p className="text-base font-medium">No hay presupuestos que mostrar</p>
        </div>
      ) : (
        <>
          {abiertos && (
            <GrupoListado
              titulo="Por atender"
              cantidad={abiertos.total}
              detalle={abiertos.total > 0 ? formatearMonto(abiertos.monto) : undefined}
              destacado
            >
              {abiertos.filas.map((p) => (
                <Tarjeta key={p.id} presupuesto={p} />
              ))}
              {cerrados ? (
                <Paginador
                  pagina={paginaAbiertos}
                  total={abiertos.total}
                  params={vigentes}
                  nombre="espera"
                />
              ) : (
                paginador
              )}
            </GrupoListado>
          )}

          {cerrados && (
            <GrupoListado
              titulo="Cerrados"
              cantidad={cerrados.total}
              vacio={
                <p className="px-1 text-base text-texto-2">
                  Ninguno cerrado todavía.
                </p>
              }
            >
              {/* Un renglón por cerrado (mes simulado: con 40 en el mes, la
                  página medía 9.500 px en el teléfono y lo abierto quedaba
                  arriba en dos tarjetas). */}
              {cerrados.filas.length > 0 && (
                <ul className="tarjeta divide-y divide-linea overflow-hidden">
                  {cerrados.filas.map((p) => (
                    <Renglon key={p.id} presupuesto={p} />
                  ))}
                </ul>
              )}
              {paginador}
            </GrupoListado>
          )}
        </>
      )}
    </div>
  );
}

/** Un cerrado en una línea: cliente, número, total y estado. */
function Renglon({ presupuesto: p }: { presupuesto: PresupuestoListado }) {
  return (
    <li>
      <Link
        href={`/admin/presupuestos/${p.id}`}
        className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/40"
      >
        <span className="min-w-0 flex-1">
          {/* Entero, en dos renglones si hace falta: a 375 px se cortaba
              «RF Construcciones S…». */}
          <span className="block break-words text-base font-medium">{p.cliente}</span>
          <span className="codigo block text-sm text-muted-foreground">
            {p.numero}
            {p.numeroPedido && ` · ${p.numeroPedido}`}
          </span>
        </span>
        <span className="flex shrink-0 flex-col items-end gap-1">
          <span className="tabular text-base">{formatearMonto(p.total)}</span>
          <EtiquetaEstado estado={p.vencido && p.estado !== "rechazado" ? "vencido" : p.estado} />
        </span>
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      </Link>
    </li>
  );
}

function Tarjeta({ presupuesto: p }: { presupuesto: PresupuestoListado }) {
  // La razón social igual al nombre no se repite (mes simulado).
  const empresa = p.empresa && p.empresa !== p.cliente ? p.empresa : null;
  const aceptado = p.estado === "aceptado";
  return (
    <article className="tarjeta tarjeta-activa relative overflow-hidden">
      <AcentoEstado estado={p.estado} />

      <div className="flex flex-wrap items-start justify-between gap-4 py-5 pl-6 pr-5">
        <div className="min-w-0">
          {/* El cliente es lo que se busca al escanear, no el número. */}
          <div className="flex flex-wrap items-center gap-2.5">
            <h3 className="text-lg font-medium">{p.cliente}</h3>
            <EtiquetaEstado estado={p.estado} />
            {p.vencido && (
              <span className="rounded-full bg-muted px-2.5 py-1 text-sm font-medium text-muted-foreground">
                Vencido
              </span>
            )}

            {/* El compromiso de respuesta —el mismo día, o 24 horas hábiles si
                es express—. Va al lado del nombre y no en la letra chica: un
                plazo que hay que buscar es un plazo que no se cumple. */}
            {p.plazo && (
              <span
                className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-sm font-medium ${
                  p.plazo.vencido
                    ? "estado-problema bg-[var(--estado-fondo)] text-[var(--estado-tinta)]"
                    : p.plazo.urgente
                      ? "bg-brand-orange/15 text-brand-orange-dark"
                      : "estado-info bg-[var(--estado-fondo)] text-[var(--estado-tinta)]"
                }`}
              >
                <Timer className="h-4 w-4" />
                {p.plazo.texto}
              </span>
            )}

            {/* Para cuándo lo necesita la obra. Es distinto del plazo de
                respuesta —eso es cuándo contestamos nosotros— y es lo que
                decide qué se arma primero cuando hay tres esperando. */}
            {p.necesitaPara && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-sm font-medium text-muted-foreground">
                <CalendarClock className="h-4 w-4" />
                Lo necesita el {fechaCorta.format(p.necesitaPara)}
              </span>
            )}
          </div>

          {empresa && <p className="text-base text-muted-foreground">{empresa}</p>}

          {/* Cada dato con su «·» pegado: sueltos, a 390 px el punto
              quedaba solo al principio o al final del renglón (comité
              final). */}
          <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-base text-muted-foreground">
            {[
              <Link
                key="numero"
                href={`/admin/presupuestos/${p.id}`}
                className="tabular font-medium text-foreground hover:text-brand-orange"
              >
                {p.numero}
              </Link>,
              <span key="items">{plural(p.items, "producto")}</span>,
              <span key="origen">{ORIGEN[p.origen] ?? p.origen}</span>,
              // De qué sucursal salió: la central y Canosa presupuestan las
              // dos, y la clienta pidió que se distingan.
              p.sucursal ? (
                <span key="sucursal" className="font-medium text-foreground">
                  {p.sucursal}
                </span>
              ) : null,
              <span key="hace">{haceCuanto(p.createdAt)}</span>,
              p.validoHasta && !p.vencido ? (
                <span key="vale">vale hasta {fechaCorta.format(p.validoHasta)}</span>
              ) : null,
            ]
              .filter((dato) => dato !== null)
              .map((dato, i, datos) => (
                <span key={i} className="whitespace-nowrap">
                  {dato}
                  {i < datos.length - 1 && (
                    <span aria-hidden="true" className="ml-2">
                      ·
                    </span>
                  )}
                </span>
              ))}
          </p>
        </div>

        {/* Con flex-wrap: en el teléfono los botones bajan abajo del total
            en vez de quedar cortados por el borde. */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <p className="tabular text-xl font-semibold">
            {formatearMonto(p.total)}
          </p>
          {/* La acción principal a mano; el resto (corregir, mandárselo,
              rechazar) en la ficha. El paso a pedido abre ahí, con el
              disponible de la cuenta y las zonas. */}
          <Link
            href={`/admin/presupuestos/${p.id}${aceptado ? "?pasar=1" : ""}`}
            className={`inline-flex h-11 items-center gap-1.5 whitespace-nowrap rounded-lg px-4 text-base font-medium transition-colors ${
              aceptado ? "boton-accion" : "bg-hundida hover:bg-muted"
            }`}
          >
            {aceptado ? <ShoppingCart className="h-5 w-5" aria-hidden="true" /> : null}
            {aceptado ? "Pasar a pedido" : "Abrir"}
          </Link>
        </div>
      </div>
    </article>
  );
}
