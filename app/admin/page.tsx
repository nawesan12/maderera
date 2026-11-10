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
 * Son dos franjas y los números: lo que está esperando y lo que se puede
 * empezar. El panel entero en botones («Ir a») se sacó el 10/11: repetía el
 * menú lateral y el buscador, y eran treinta cajas sueltas. **Los botones no
 * consultan nada**: lo único que pregunta a la base es el trabajo pendiente,
 * y los números llegan después, adentro de un `<Suspense>`.
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
          <Encabezado titulo="Para hoy" />
          {/* Una hoja con los números en columnas, no una caja por número: lo
              urgente se distingue por el color de la cifra. */}
          <div className="tarjeta grid divide-y divide-linea-suave sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-4 [&>*]:sm:border-l [&>*]:sm:border-linea-suave [&>*:first-child]:sm:border-l-0">
            {pendientes.map((p) => (
              <Link
                key={p.clave}
                href={p.href}
                className={`group flex flex-col gap-2 px-6 py-5 transition-colors hover:bg-hundida/60 ${
                  p.urgente ? "estado-problema" : ""
                }`}
              >
                <span
                  className={`tabular text-[44px] font-extrabold leading-none tracking-[-0.04em] ${
                    p.urgente ? "text-[var(--estado-tinta)]" : ""
                  }`}
                >
                  {p.cantidad}
                </span>
                <span className="text-base font-semibold leading-tight group-hover:underline">
                  {p.texto}
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {acciones.length > 0 && (
        <section>
          <Encabezado titulo="Empezar algo" />
          <div className="flex flex-wrap gap-2.5">
            {acciones.map((a, n) => (
              <Link
                key={a.href}
                href={a.href}
                className={`inline-flex h-11 items-center gap-2 rounded-full px-4 text-[15px] font-semibold ${
                  n === 0 ? "bg-accion text-white" : "border bg-card"
                }`}
              >
                <a.icon className={`h-[18px] w-[18px] ${n === 0 ? "" : "text-acento-texto"}`} />
                {a.label}
              </Link>
            ))}
          </div>
        </section>
      )}

      {veLosNumeros && (
        <section className="border-t border-dashed border-linea pt-6">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
            <Encabezado
              titulo="Los números"
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
  sinMargen = false,
}: {
  titulo: string;
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
