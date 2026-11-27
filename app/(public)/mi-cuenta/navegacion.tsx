"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ArrowLeftRight,
  ChevronDown,
  FileText,
  LayoutGrid,
  MapPin,
  Package,
  Receipt,
  ScrollText,
  Star,
  UserRound,
} from "lucide-react";

/**
 * Navegación del portal.
 *
 * Cada sección lleva su contador al lado, y solo cuando hay algo que atender:
 * un cero dibujado en gris ocupa lugar y no dice nada. Así la barra contesta
 * "¿tengo algo pendiente?" antes de entrar a ninguna pantalla.
 *
 * En escritorio es una columna al costado. En el teléfono, una sola fila con
 * lo que más se usa y «Más» para el resto: las nueve píldoras ocupaban
 * cuatro o cinco renglones y empujaban el saldo fuera de la primera pantalla
 * (mes simulado, M2S1-069 y M2S2-051). Nada se corre de costado (H093).
 */
const SECCIONES = [
  { href: "/mi-cuenta", titulo: "Resumen", icono: LayoutGrid, exacto: true },
  { href: "/mi-cuenta/pedidos", titulo: "Pedidos", icono: Package },
  { href: "/mi-cuenta/presupuestos", titulo: "Presupuestos", icono: ScrollText },
  { href: "/mi-cuenta/comprobantes", titulo: "Facturas", icono: FileText },
  // Para todos: quien compra de contado también tiene movimientos.
  { href: "/mi-cuenta/movimientos", titulo: "Movimientos", icono: ArrowLeftRight },
  {
    href: "/mi-cuenta/cuenta-corriente",
    titulo: "Cuenta corriente",
    icono: Receipt,
  },
  { href: "/mi-cuenta/resenas", titulo: "Reseñas", icono: Star },
  { href: "/mi-cuenta/direcciones", titulo: "Direcciones", icono: MapPin },
  { href: "/mi-cuenta/datos", titulo: "Mis datos", icono: UserRound },
] as const;

export function NavegacionCuenta({
  pedidosEnCurso,
  presupuestosAResponder,
  operaACuenta,
  saldo,
}: {
  pedidosEnCurso: number;
  presupuestosAResponder: number;
  operaACuenta: boolean;
  saldo: React.ReactNode;
}) {
  const pathname = usePathname();

  const contadores: Record<string, number> = {
    "/mi-cuenta/pedidos": pedidosEnCurso,
    "/mi-cuenta/presupuestos": presupuestosAResponder,
  };

  const visibles = SECCIONES.filter(
    (s) => operaACuenta || s.href !== "/mi-cuenta/cuenta-corriente",
  );
  const esActiva = (s: (typeof SECCIONES)[number]) =>
    "exacto" in s && s.exacto ? pathname === s.href : pathname.startsWith(s.href);

  return (
    <nav aria-label="Secciones de mi cuenta">
      <EnElTelefono visibles={visibles} contadores={contadores} operaACuenta={operaACuenta} esActiva={esActiva} />
      <ul className="hidden lg:flex lg:flex-col lg:gap-1.5">
        {visibles.map((seccion) => {
          const activa =
            "exacto" in seccion && seccion.exacto
              ? pathname === seccion.href
              : pathname.startsWith(seccion.href);
          const contador = contadores[seccion.href] ?? 0;

          return (
            <li key={seccion.href} className="lg:shrink">
              <Link
                href={seccion.href}
                aria-current={activa ? "page" : undefined}
                /*
                 * El fondo del ítem activo se dibuja acá y no en un elemento
                 * aparte. Antes se deslizaba de una sección a otra con el
                 * `layoutId` de framer-motion: quedaba lindo, pero era la única
                 * animación del sitio que no se puede hacer con CSS, y sostener
                 * por ella una librería que baja todo el que entra a cualquier
                 * página salía mucho más caro de lo que valía.
                 */
                className={`relative flex min-h-11 items-center gap-2 rounded-[10px] px-3 py-2 text-[15px] transition-colors lg:w-full lg:gap-[11px] lg:py-[11px] ${
                  activa
                    ? "bg-card font-semibold text-foreground shadow-[inset_0_-3px_0_0_var(--color-accion),0_1px_2px_rgb(60_50_40_/_0.06)] lg:shadow-[inset_3px_0_0_0_var(--color-accion),0_1px_2px_rgb(60_50_40_/_0.06)]"
                    : "bg-hundida text-texto-2 hover:text-foreground lg:bg-transparent lg:hover:bg-black/[0.03]"
                }`}
              >
                <seccion.icono
                  className={`h-[18px] w-[18px] shrink-0 ${
                    activa ? "text-acento-texto" : "text-texto-3"
                  }`}
                />
                <span className="whitespace-nowrap">{seccion.titulo}</span>

                {contador > 0 && (
                  <span
                    className="tabular flex h-[22px] lg:ml-auto min-w-[22px] items-center justify-center rounded-full bg-naranja-claro px-1.5 text-[12.5px] font-semibold text-acento-sobre-claro"
                    aria-label={`${contador} pendiente${contador === 1 ? "" : "s"}`}
                  >
                    {contador}
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>

      {/* El saldo al pie de la navegación acompaña en todas las pantallas menos
          las que ya lo muestran grande arriba (el resumen, la cuenta y los
          movimientos): repetirlo ahí lo vuelve ruido (M2S4-059). */}
      {!CON_SALDO_PROPIO.includes(pathname) && saldo}
    </nav>
  );
}

const CON_SALDO_PROPIO = ["/mi-cuenta", "/mi-cuenta/cuenta-corriente", "/mi-cuenta/movimientos"];

type Seccion = (typeof SECCIONES)[number];

/** Las tres de todos los días, en el teléfono; el resto va en «Más». */
function EnElTelefono({
  visibles,
  contadores,
  operaACuenta,
  esActiva,
}: {
  visibles: readonly Seccion[];
  contadores: Record<string, number>;
  operaACuenta: boolean;
  esActiva: (s: Seccion) => boolean;
}) {
  const [abierto, setAbierto] = useState(false);
  const fijas = [
    "/mi-cuenta",
    "/mi-cuenta/pedidos",
    operaACuenta ? "/mi-cuenta/cuenta-corriente" : "/mi-cuenta/presupuestos",
  ];
  const principales = visibles.filter((s) => fijas.includes(s.href));
  const resto = visibles.filter((s) => !fijas.includes(s.href));
  const activaEnResto = resto.find(esActiva);
  const pendientesEnResto = resto.reduce((n, s) => n + (contadores[s.href] ?? 0), 0);
  const celda = (activa: boolean) =>
    `relative flex h-[58px] w-full flex-col items-center justify-center gap-1 rounded-[10px] px-1 text-[12.5px] leading-tight transition-colors ${
      activa
        ? "bg-card font-semibold text-foreground shadow-[inset_0_-3px_0_0_var(--color-accion),0_1px_2px_rgb(60_50_40_/_0.06)]"
        : "bg-hundida text-texto-2"
    }`;

  return (
    <div className="lg:hidden">
      <ul className="grid grid-cols-4 gap-1.5">
        {principales.map((s) => {
          const activa = esActiva(s);
          const n = contadores[s.href] ?? 0;
          return (
            <li key={s.href} className="min-w-0">
              <Link href={s.href} aria-current={activa ? "page" : undefined} className={celda(activa)}>
                <s.icono className={`h-[18px] w-[18px] shrink-0 ${activa ? "text-acento-texto" : "text-texto-3"}`} />
                <span className="max-w-full truncate">
                  {s.href === "/mi-cuenta/cuenta-corriente" ? "Cuenta" : s.titulo}
                </span>
                {n > 0 && <Contador n={n} className="absolute right-1 top-1" />}
              </Link>
            </li>
          );
        })}
        <li className="min-w-0">
          <button
            type="button"
            aria-expanded={abierto}
            aria-controls="mi-cuenta-mas"
            onClick={() => setAbierto((a) => !a)}
            className={celda(Boolean(activaEnResto))}
          >
            {activaEnResto ? (
              <activaEnResto.icono className="h-[18px] w-[18px] shrink-0 text-acento-texto" />
            ) : (
              <ChevronDown className={`h-[18px] w-[18px] shrink-0 text-texto-3 transition-transform ${abierto ? "rotate-180" : ""}`} />
            )}
            <span className="max-w-full truncate">{activaEnResto ? activaEnResto.titulo : "Más"}</span>
            {pendientesEnResto > 0 && <Contador n={pendientesEnResto} className="absolute right-1 top-1" />}
          </button>
        </li>
      </ul>
      {abierto && (
        <ul id="mi-cuenta-mas" className="mt-1.5 flex flex-wrap gap-1.5">
          {resto.map((s) => {
            const activa = esActiva(s);
            const n = contadores[s.href] ?? 0;
            return (
              <li key={s.href}>
                <Link
                  href={s.href}
                  onClick={() => setAbierto(false)}
                  aria-current={activa ? "page" : undefined}
                  className={`flex min-h-11 items-center gap-2 rounded-[10px] px-3 py-2 text-[15px] ${
                    activa ? "bg-card font-semibold text-foreground" : "bg-hundida text-texto-2"
                  }`}
                >
                  <s.icono className={`h-[18px] w-[18px] shrink-0 ${activa ? "text-acento-texto" : "text-texto-3"}`} />
                  <span className="whitespace-nowrap">{s.titulo}</span>
                  {n > 0 && <Contador n={n} />}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function Contador({ n, className = "" }: { n: number; className?: string }) {
  return (
    <span
      className={`tabular flex h-[20px] min-w-[20px] items-center justify-center rounded-full bg-naranja-claro px-1.5 text-[12px] font-semibold text-acento-sobre-claro ${className}`}
      aria-label={`${n} pendiente${n === 1 ? "" : "s"}`}
    >
      {n}
    </span>
  );
}
