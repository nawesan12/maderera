import { Suspense } from "react";
import Link from "next/link";
import {
  Banknote,
  Boxes,
  FileText,
  ReceiptText,
  Scissors,
  Store,
  Users,
  Warehouse,
} from "lucide-react";
import { seccionesPara } from "@/components/admin/secciones";
import { NumerosDelNegocio } from "@/components/admin/numeros-del-negocio";
import { FiltroPeriodo } from "@/components/admin/filtro-periodo";
import { leerPeriodo, resolverPeriodo } from "@/lib/periodos";
import { trabajoPendiente } from "@/lib/dal/admin/pendientes";
import { requireStaff } from "@/lib/dal/session";
import { puedeEntrar } from "@/lib/roles";

/**
 * La primera pantalla del panel.
 *
 * **Antes era un tablero y ahora es un lugar desde donde se trabaja.**
 * Contestaba «cómo viene el negocio» —ventas, gráficos, listados— y costaba
 * veinte consultas a la base que además frenaban el dibujo: no aparecía nada
 * hasta que la última terminaba. Para hacer cualquier cosa había que ir igual
 * al menú lateral a buscarla, que es lo que un resumen existe para evitar.
 *
 * Ahora son tres franjas, de lo que urge a lo que se consulta: lo que está
 * esperando, lo que se puede empezar, y el panel entero en botones. **Los
 * botones no consultan nada**: lo único que pregunta a la base es el trabajo
 * pendiente, y los números llegan después, adentro de un `<Suspense>`.
 *
 * **Todo se acota por rol**, con la misma lista que usan el menú y las páginas.
 * Un botón que ofrece algo que después rebota es peor que no tenerlo.
 */

/**
 * Lo que se arranca desde cero, y que hoy no está en ningún lado.
 *
 * Son las que más se buscaban en el menú lateral: el que abre el panel a la
 * mañana viene a empezar algo, no a mirar un gráfico.
 *
 * No hace falta declararles permiso aparte: `puedeEntrar` resuelve por prefijo,
 * así que `/admin/cortes/nuevo` pregunta por la regla de `/admin/cortes`, que
 * es la misma que después deja entrar o rebota.
 */
const ACCIONES = [
  { href: "/mostrador", icon: Store, label: "Vender en el mostrador" },
  {
    href: "/admin/presupuestos/nuevo",
    icon: FileText,
    label: "Armar un presupuesto",
  },
  { href: "/admin/cortes/nuevo", icon: Scissors, label: "Tomar un corte" },
  { href: "/admin/clientes?nuevo=1", icon: Users, label: "Nuevo cliente" },
  { href: "/admin/productos/nuevo", icon: Boxes, label: "Nuevo producto" },
  { href: "/admin/stock", icon: Warehouse, label: "Ajustar stock" },
  {
    href: "/admin/compras/facturas",
    icon: ReceiptText,
    label: "Cargar factura de compra",
  },
  { href: "/admin/caja", icon: Banknote, label: "Abrir la caja" },
] as const;

export default async function ResumenPage({
  searchParams,
}: {
  searchParams: Promise<{ periodo?: string }>;
}) {
  const [{ staffRole }, pendientes] = await Promise.all([
    requireStaff(),
    trabajoPendiente(),
  ]);

  const periodo = resolverPeriodo(leerPeriodo((await searchParams).periodo));
  /*
   * Todo el panel menos esta pantalla: un botón que lleva a donde uno ya está
   * es un renglón que se lee y no sirve.
   */
  const grupos = seccionesPara(staffRole)
    .map((s) => ({ ...s, items: s.items.filter((i) => i.href !== "/admin") }))
    .filter((s) => s.items.length > 0);
  const acciones = ACCIONES.filter((a) =>
    puedeEntrar(a.href.split("?")[0], staffRole),
  );

  /*
   * Los números son de administración y no de todo el personal: son la
   * facturación, lo que falta cobrar y el ticket promedio. Hasta ahora el
   * vendedor y el depósito los veían al abrir el panel.
   */
  const veLosNumeros = staffRole === "admin";

  return (
    <div className="space-y-8">
      <h1 className="sr-only">Panel</h1>

      {pendientes.length > 0 && (
        <section>
          <Encabezado
            titulo="Para hoy"
            detalle="Lo que espera que alguien lo toque. Cada botón abre la pantalla que lo resuelve, ya filtrada."
          />
          <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {pendientes.map((p) => (
              <Link
                key={p.clave}
                href={p.href}
                className={`group relative overflow-hidden rounded-xl border p-4 pt-[17px] transition-colors ${
                  p.urgente
                    ? "estado-problema border-[color-mix(in_oklab,var(--estado-acento)_35%,transparent)] bg-[var(--estado-fondo)]"
                    : "textura border-linea bg-card hover:border-accion"
                }`}
              >
                <span
                  className={`absolute inset-x-0 top-0 h-[3px] ${
                    p.urgente ? "bg-[var(--estado-acento)]" : "bg-linea"
                  }`}
                  aria-hidden="true"
                />
                <span
                  className={`tabular block text-[30px] font-extrabold leading-none tracking-tight ${
                    p.urgente ? "text-[var(--estado-tinta)]" : ""
                  }`}
                >
                  {p.cantidad}
                </span>
                <span className="mt-1.5 block text-[14.5px] font-semibold leading-tight">
                  {p.texto}
                </span>
                {p.detalle && (
                  <span className="mt-0.5 block text-[12.5px] leading-snug text-texto-3">
                    {p.detalle}
                  </span>
                )}
              </Link>
            ))}
          </div>
        </section>
      )}

      {acciones.length > 0 && (
        <section>
          <Encabezado
            titulo="Empezar algo"
            detalle="Lo que se arranca desde cero, sin pasar por el menú."
          />
          <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {acciones.map((a) => (
              <Link
                key={a.href}
                href={a.href}
                className="textura group relative flex items-center gap-3 overflow-hidden rounded-xl border border-linea bg-card py-4 pl-[17px] pr-4 text-[14.5px] font-bold transition-colors hover:border-accion"
              >
                <span
                  className="absolute inset-y-0 left-0 w-1 bg-accion"
                  aria-hidden="true"
                />
                <span className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-[11px] bg-naranja-claro text-acento-sobre-claro">
                  <a.icon className="h-[22px] w-[22px]" />
                </span>
                {a.label}
              </Link>
            ))}
          </div>
        </section>
      )}

      <section>
        <Encabezado
          titulo="Ir a"
          detalle="Todo el panel, en botones. Es lo que evita el viaje al menú lateral."
        />
        <div className="space-y-4">
          {grupos.map((g) => (
            <div key={g.titulo}>
              <h3 className="mb-2 flex items-center gap-2 text-[10.5px] font-bold uppercase tracking-[0.14em] text-texto-3">
                <span
                  className="h-[3px] w-[22px] rounded-full bg-accion"
                  aria-hidden="true"
                />
                {g.titulo}
              </h3>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5">
                {g.items.map((i) => (
                  <Link
                    key={i.href}
                    href={i.href}
                    className="flex items-center gap-2.5 rounded-[11px] border border-linea bg-card px-3 py-2.5 text-sm font-semibold transition-colors hover:border-accion"
                  >
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-hundida text-acento-texto">
                      <i.icon className="h-4 w-4" />
                    </span>
                    {i.label}
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      {veLosNumeros && (
        <section className="border-t border-dashed border-linea pt-6">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
            <Encabezado
              titulo="Los números"
              detalle={`Cómo viene el negocio · ${periodo.etiqueta.toLowerCase()}`}
              sinMargen
            />
            <FiltroPeriodo actual={periodo.clave} />
          </div>
          {/* Llegan después de que la pantalla ya se pintó: son catorce de las
              veinte consultas que antes frenaban todo. */}
          <Suspense fallback={<NumerosCargando />}>
            <NumerosDelNegocio periodo={periodo} />
          </Suspense>
        </section>
      )}
    </div>
  );
}

function Encabezado({
  titulo,
  detalle,
  sinMargen = false,
}: {
  titulo: string;
  detalle: string;
  sinMargen?: boolean;
}) {
  return (
    <div className={sinMargen ? "" : "mb-3.5"}>
      <h2 className="flex items-center gap-2.5 text-[19px] font-bold tracking-tight">
        {/* La veta, el mismo separador que el sitio público, pero corta: cuatro
            franjas naranjas de lado a lado tapaban la pantalla en vez de
            ordenarla. */}
        <span className="wood-divider w-8 shrink-0" aria-hidden="true" />
        {titulo}
      </h2>
      <p className="mt-1 text-sm text-texto-2">{detalle}</p>
    </div>
  );
}

function NumerosCargando() {
  return (
    <div
      className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
      aria-busy="true"
      aria-live="polite"
    >
      <span className="sr-only">Trayendo los números…</span>
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="h-[92px] animate-pulse rounded-xl bg-hundida" />
      ))}
    </div>
  );
}
