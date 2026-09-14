"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
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
 * En escritorio es una columna al costado; en el teléfono, una fila de píldoras
 * que se desliza, que es lo que se puede tocar con el pulgar.
 */
const SECCIONES = [
  { href: "/mi-cuenta", titulo: "Resumen", icono: LayoutGrid, exacto: true },
  { href: "/mi-cuenta/pedidos", titulo: "Pedidos", icono: Package },
  { href: "/mi-cuenta/presupuestos", titulo: "Presupuestos", icono: ScrollText },
  { href: "/mi-cuenta/comprobantes", titulo: "Facturas", icono: FileText },
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

  return (
    <nav aria-label="Secciones de mi cuenta">
      <ul className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-2 lg:mx-0 lg:flex-col lg:overflow-visible lg:px-0 lg:pb-0">
        {visibles.map((seccion) => {
          const activa =
            "exacto" in seccion && seccion.exacto
              ? pathname === seccion.href
              : pathname.startsWith(seccion.href);
          const contador = contadores[seccion.href] ?? 0;

          return (
            <li key={seccion.href} className="shrink-0 lg:shrink">
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
                className={`relative flex items-center gap-[11px] rounded-[10px] px-3 py-[11px] text-[15px] transition-colors lg:w-full ${
                  activa
                    ? "bg-card font-semibold text-foreground shadow-[inset_3px_0_0_0_var(--color-accion),0_1px_2px_rgb(60_50_40_/_0.06)]"
                    : "text-texto-2 hover:bg-black/[0.03] hover:text-foreground"
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
                    className="tabular ml-auto flex h-[22px] min-w-[22px] items-center justify-center rounded-full bg-naranja-claro px-1.5 text-[12.5px] font-semibold text-acento-sobre-claro"
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
          el resumen, que ya lo muestra grande arriba: repetirlo ahí lo vuelve
          ruido y le saca peso justo donde tiene que tenerlo. */}
      {pathname !== "/mi-cuenta" && saldo}
    </nav>
  );
}
