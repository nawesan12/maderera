import { Suspense } from "react";
import Link from "next/link";
import {
  Banknote,
  BellRing,
  Boxes,
  ClipboardList,
  FileText,
  HandCoins,
  PackageCheck,
  ReceiptText,
  Scissors,
  Store,
  Users,
  Wallet,
  Warehouse,
} from "lucide-react";
import { NumerosDelNegocio } from "@/components/admin/numeros-del-negocio";
import { FiltroPeriodo } from "@/components/admin/filtro-periodo";
import { CeldaPin } from "@/components/admin/aviso-sin-pin";
import { AvisosPush } from "@/components/admin/avisos-push";
import { leerPeriodo, resolverPeriodo } from "@/lib/periodos";
import { trabajoPendiente } from "@/lib/dal/admin/pendientes";
import { requireStaff } from "@/lib/dal/session";
import { api, datos } from "@/lib/api/servidor";
import { puedeEntrar } from "@/lib/roles";
import { CLAVES_EN_LAS_LISTAS_DEL_DEPOSITO, partirPendientes } from "@/lib/inicio";
import {
  InicioDelDeposito,
  InicioDelDepositoCargando,
} from "@/components/admin/inicio-deposito";

/**
 * La primera pantalla del panel.
 *
 * **Antes era un tablero y ahora es un lugar desde donde se trabaja.**
 * Contestaba «cómo viene el negocio» —ventas, gráficos, listados— y costaba
 * veinte consultas a la base que además frenaban el dibujo: no aparecía nada
 * hasta que la última terminaba. Para hacer cualquier cosa había que ir igual
 * al menú lateral a buscarla, que es lo que un resumen existe para evitar.
 *
 * Son las franjas y los números: lo urgente («Para hoy»), lo que se puede
 * empezar y lo que espera sin apuro («Pendientes», más quieto: cinco medidas
 * sin foto no pesan lo mismo que un cheque que vence mañana). El panel entero en botones («Ir a») se sacó el 10/11: repetía el
 * menú lateral y el buscador, y eran treinta cajas sueltas. **Los botones no
 * consultan nada**: lo único que pregunta a la base es el trabajo pendiente,
 * y los números llegan después, adentro de un `<Suspense>`.
 *
 * **El orden depende de quién abre** (mes simulado, H298): la dueña abre el
 * panel para saber qué atender y cómo está la plata, así que después de «Para
 * hoy» van los números y los botones quedan al final (en el teléfono, «Los
 * números» arrancaba a 1.400 px). Quien vende o prepara viene a empezar algo:
 * para ellos los botones siguen arriba de lo que espera sin apuro.
 *
 * **Todo se acota por rol**, con la misma lista que usan el menú y las páginas.
 * Un botón que ofrece algo que después rebota es peor que no tenerlo.
 */

/**
 * Lo que se arranca desde cero, y que hoy no está en ningún lado.
 *
 * Son las que más se buscaban en el menú lateral: el que abre el panel a la
 * mañana viene a empezar algo, no a mirar un gráfico. Las de compras se
 * sumaron con el mes simulado (H067): la dueña compra, y de compras solo
 * estaba la factura.
 *
 * No hace falta declararles permiso aparte: `puedeEntrar` resuelve por prefijo,
 * así que `/admin/cortes/nuevo` pregunta por la regla de `/admin/cortes`, que
 * es la misma que después deja entrar o rebota.
 *
 * `soloPantallaGrande`: el mostrador no se usa en el teléfono (es una decisión
 * tomada; la pantalla lo dice y vuelve al panel), y era el botón más grande
 * del inicio a 375 px (H369). Debajo de `md` no se ofrece, y la acción
 * principal pasa a ser la siguiente.
 */
const ACCIONES = [
  { href: "/mostrador", icon: Store, label: "Vender en el mostrador", soloPantallaGrande: true },
  {
    href: "/admin/presupuestos/nuevo",
    icon: FileText,
    label: "Armar un presupuesto",
  },
  { href: "/admin/cortes/nuevo", icon: Scissors, label: "Tomar un corte" },
  { href: "/admin/clientes?nuevo=1", icon: Users, label: "Nuevo cliente" },
  { href: "/admin/stock", icon: Warehouse, label: "Ajustar stock" },
  { href: "/admin/caja", icon: Banknote, label: "Abrir la caja" },
  { href: "/admin/compras/ordenes/nueva", icon: ClipboardList, label: "Nueva orden de compra" },
  { href: "/admin/recepciones/nueva", icon: PackageCheck, label: "Recibir mercadería" },
  {
    href: "/admin/compras/facturas",
    icon: ReceiptText,
    label: "Cargar factura de compra",
  },
  { href: "/admin/compras/pagos", icon: HandCoins, label: "Pagar a un proveedor" },
  { href: "/admin/compras/gastos", icon: Wallet, label: "Anotar un gasto" },
  { href: "/admin/productos/nuevo", icon: Boxes, label: "Nuevo producto" },
] as const;

/*
 * Una celda de «Para hoy». La grilla dibuja las rayas con el borde de arriba
 * y el de la izquierda de cada celda, corrida un píxel: así no queda una raya
 * suelta al borde ni un hueco gris cuando la última fila no se llena.
 */
const CELDA =
  "group flex min-w-0 flex-col gap-1.5 border-l border-t border-linea-suave px-4 py-4 transition-colors hover:bg-hundida/60 sm:gap-2 sm:px-6 sm:py-5";

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
  const { paraHoy, pendientes: sinApuro } = partirPendientes(
    pendientes,
    staffRole === "deposito" ? CLAVES_EN_LAS_LISTAS_DEL_DEPOSITO : [],
  );
  // Solo si hay que cargar el PIN: la cuenta que entra con link no tiene
  // clave, y el diálogo la manda a ponérsela en vez de pedirla (H001).
  const tieneClave = paraHoy.some((p) => p.clave === "pin")
    ? (await (await api()).GET("/api/v1/sesion/clave").then(datos)).tieneClave
    : true;

  const seccionParaHoy = paraHoy.length > 0 && (
    <section>
      <Encabezado titulo="Para hoy" />
      {/* Una hoja con los números en columnas, no una caja por número: en el
          teléfono van de a dos (de a una, tres cifras llenaban la pantalla).
          Todo lo de acá es de hoy; el rojo queda para lo vencido (Go lo
          marca), así sigue diciendo algo: con «3 pedidos por preparar»
          también en rojo, la hoja era una alarma todas las mañanas. */}
      <div className="tarjeta overflow-hidden">
        <div className="-ml-px -mt-px grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4">
          {paraHoy.map((p) =>
            p.clave === "pin" ? (
              <CeldaPin key={p.clave} texto={p.texto} tieneClave={tieneClave} className={CELDA} />
            ) : (
              <Link
                key={p.clave}
                href={p.href}
                className={`${CELDA} ${p.vencido ? "estado-problema" : ""}`}
              >
                <span
                  className={`tabular text-[32px] font-extrabold leading-none tracking-[-0.04em] sm:text-[44px] ${
                    p.vencido ? "text-[var(--estado-tinta)]" : ""
                  }`}
                >
                  {p.clave === "avisos" ? (
                    <BellRing className="h-8 w-8 text-acento-texto sm:h-11 sm:w-11" aria-hidden="true" />
                  ) : (
                    p.cantidad
                  )}
                </span>
                <span className="text-[15px] font-semibold leading-tight group-hover:underline sm:text-base">
                  {p.texto}
                </span>
              </Link>
            ),
          )}
        </div>
      </div>
    </section>
  );

  /*
   * La acción principal es la primera que se puede usar en ese ancho: con el
   * mostrador primero, en el teléfono pasa a la segunda.
   */
  const conMostrador = acciones[0]?.href === "/mostrador";
  const seccionEmpezar = acciones.length > 0 && (
    <section>
      <Encabezado titulo="Empezar algo" />
      <div className="flex flex-wrap gap-2.5">
        {acciones.map((a, n) => {
          const principal = n === 0;
          const principalEnElTelefono = conMostrador && n === 1;
          return (
            <Link
              key={a.href}
              href={a.href}
              className={`group/accion items-center gap-2 rounded-full px-4 text-[15px] font-semibold h-11 ${
                "soloPantallaGrande" in a && a.soloPantallaGrande ? "hidden md:inline-flex" : "inline-flex"
              } ${
                principal
                  ? "bg-accion text-white"
                  : principalEnElTelefono
                    ? "max-md:bg-accion max-md:text-white md:border md:bg-card"
                    : "border bg-card"
              }`}
            >
              <a.icon
                className={`h-[18px] w-[18px] ${
                  principal ? "" : principalEnElTelefono ? "md:text-acento-texto" : "text-acento-texto"
                }`}
              />
              {a.label}
            </Link>
          );
        })}
      </div>
    </section>
  );

  const seccionPendientes = sinApuro.length > 0 && (
    <section>
      <Encabezado titulo="Pendientes" />
      {/* Pastillas quietas, el mismo idioma que «Empezar algo» sin el
          fondo: se toca cada una con el dedo, y un renglón con «·»
          se cortaba en cualquier lado en el teléfono. El orden lo da Go:
          lo vencido y lo grande primero, la carga del catálogo al final. */}
      <ul className="flex flex-wrap gap-2.5">
        {sinApuro.map((p) => (
          <li key={p.clave}>
            <Link
              href={p.href}
              className="inline-flex min-h-11 items-center gap-2 rounded-full border border-linea-suave px-4 text-[15px] text-texto-2 transition-colors hover:bg-hundida/60 hover:text-foreground"
            >
              <span className="tabular font-bold text-foreground">{p.cantidad}</span>
              {p.texto}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );

  return (
    <div className="space-y-8">
      <h1 className="sr-only">Panel</h1>

      {staffRole === "admin" && <AvisosPush soloSiFaltan />}

      {seccionParaHoy}

      {staffRole === "deposito" && (
        <Suspense fallback={<InicioDelDepositoCargando />}>
          <InicioDelDeposito />
        </Suspense>
      )}

      {veLosNumeros ? (
        <>
          <section>
            <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
              <Encabezado titulo="Los números" sinMargen />
              <FiltroPeriodo actual={periodo.clave} />
            </div>
            {/* Llegan después de que la pantalla ya se pintó: son catorce de las
                veinte consultas que antes frenaban todo. */}
            <Suspense fallback={<NumerosCargando />}>
              <NumerosDelNegocio periodo={periodo} />
            </Suspense>
          </section>
          {seccionPendientes}
          {seccionEmpezar}
        </>
      ) : (
        <>
          {seccionEmpezar}
          {seccionPendientes}
        </>
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
      className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3"
      aria-busy="true"
      aria-live="polite"
    >
      <span className="sr-only">Trayendo los números…</span>
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <div key={i} className="h-[180px] animate-pulse rounded-xl bg-hundida" />
      ))}
    </div>
  );
}
