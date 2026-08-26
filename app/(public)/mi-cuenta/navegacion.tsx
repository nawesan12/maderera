"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import {
  FileText,
  LayoutGrid,
  MapPin,
  Package,
  Receipt,
  ScrollText,
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
                className={`relative flex items-center gap-2.5 rounded-xl px-3.5 py-2.5 text-[0.95rem] transition-colors lg:w-full ${
                  activa
                    ? "font-medium text-brand-orange-dark"
                    : "text-muted-foreground hover:bg-black/[0.03] hover:text-foreground"
                }`}
              >
                {activa && (
                  // El fondo del ítem activo se desliza entre secciones en
                  // lugar de aparecer de golpe: se ve de dónde vino el foco.
                  <motion.span
                    layoutId="cuenta-nav-activa"
                    className="absolute inset-0 -z-10 rounded-xl bg-brand-orange/10 ring-1 ring-inset ring-brand-orange/25"
                    transition={{ type: "spring", stiffness: 380, damping: 32 }}
                  />
                )}
                <seccion.icono className="h-[1.15rem] w-[1.15rem] shrink-0" />
                <span className="whitespace-nowrap">{seccion.titulo}</span>

                {contador > 0 && (
                  <span
                    className="tabular ml-auto flex h-6 min-w-6 items-center justify-center rounded-full bg-brand-orange px-1.5 text-xs font-semibold text-white"
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
