"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import type { LucideIcon } from "lucide-react";
import { inicioDelRol, type RolStaff } from "@/lib/roles";
import {
  ArrowUpRight,
  BookOpen,
  Boxes,
  CalendarDays,
  Tags,
  Building2,
  CircleQuestionMark,
  DatabaseZap,
  ClipboardList,
  FileText,
  Landmark,
  LayoutDashboard,
  Menu,
  Newspaper,
  MessageCircle,
  Package,
  Scissors,
  Truck,
  HardHat,
  History,
  Banknote,
  Mail,
  Store,
  Users,
  Wallet,
  X,
} from "lucide-react";

/**
 * Navegación del panel.
 *
 * Casi sin contadores: los que había antes estaban escritos a mano y no se
 * correspondían con nada, y un número que no es cierto es peor que ningún
 * número porque se deja de mirar. Lo que hay que atender aparece dentro de cada
 * pantalla, donde además se puede resolver.
 *
 * La excepción es WhatsApp, y por un motivo concreto: un mensaje sin contestar
 * no se ve desde ninguna otra pantalla y el cliente está del otro lado
 * esperando. Ese contador sale de la base, no de una constante.
 */
interface ItemNav {
  href: string;
  icon: LucideIcon;
  label: string;
  /** El único contador del menú; sale de la base. */
  contador?: "whatsapp";
  /** Quién ve esta sección. Sin declarar, la ven todos. */
  roles?: readonly RolStaff[];
}

const secciones: { titulo: string; items: ItemNav[] }[] = [
  {
    titulo: "Operación",
    items: [
      { href: "/admin", icon: LayoutDashboard, label: "Resumen", roles: ["admin", "vendedor", "deposito"] },
      { href: "/admin/pedidos", icon: Truck, label: "Pedidos", roles: ["admin", "vendedor", "deposito"] },
      {
        href: "/admin/whatsapp",
        icon: MessageCircle,
        label: "WhatsApp",
        contador: "whatsapp" as const,
        roles: ["admin", "vendedor"],
      },
      {
        href: "/admin/presupuestos",
        icon: ClipboardList,
        label: "Presupuestos",
        roles: ["admin", "vendedor"],
      },
      { href: "/admin/cortes", icon: Scissors, label: "Cortes" },
      /*
       * El mostrador es una pantalla completa fuera del panel, como el taller.
       * Va igual en el menú: es la única forma de llegar sin escribir la
       * dirección, y quien atiende entra por acá cada mañana.
       */
      {
        href: "/mostrador",
        icon: Store,
        label: "Mostrador",
        roles: ["admin", "vendedor"],
      },
    ],
  },
  {
    titulo: "Catálogo",
    items: [
      { href: "/admin/productos", icon: Boxes, label: "Productos", roles: ["admin", "vendedor"] },
      { href: "/admin/stock", icon: Package, label: "Stock", roles: ["admin", "vendedor", "deposito"] },
      { href: "/admin/precios", icon: Tags, label: "Precios", roles: ["admin"] },
    ],
  },
  {
    titulo: "Administración",
    items: [
      { href: "/admin/clientes", icon: Users, label: "Clientes", roles: ["admin", "vendedor"] },
      { href: "/admin/profesionales", icon: HardHat, label: "Profesionales", roles: ["admin", "vendedor"] },
      { href: "/admin/documentacion", icon: BookOpen, label: "Documentación", roles: ["admin", "vendedor"] },
      { href: "/admin/contenido", icon: Newspaper, label: "Contenido", roles: ["admin"] },
      { href: "/admin/eventos", icon: CalendarDays, label: "Eventos", roles: ["admin", "vendedor"] },
      { href: "/admin/pagos", icon: Wallet, label: "Cobros", roles: ["admin"] },
      { href: "/admin/facturacion", icon: FileText, label: "Facturación", roles: ["admin"] },
      { href: "/admin/arca", icon: Landmark, label: "ARCA", roles: ["admin"] },
      { href: "/admin/avisos", icon: Mail, label: "Avisos", roles: ["admin"] },
      { href: "/admin/caja", icon: Banknote, label: "Caja", roles: ["admin"] },
      { href: "/admin/sucursales", icon: Building2, label: "Sucursales", roles: ["admin"] },
      { href: "/admin/migracion", icon: DatabaseZap, label: "Migración", roles: ["admin"] },
      { href: "/admin/bitacora", icon: History, label: "Bitácora", roles: ["admin"] },
    ],
  },
];

export function AdminSidebar({
  whatsappSinLeer = 0,
  rol,
}: {
  whatsappSinLeer?: number;
  /** Qué secciones se muestran. Sin rol, se muestran todas. */
  rol?: RolStaff | null;
}) {
  const pathname = usePathname();
  const [abierto, setAbierto] = useState(false);

  /**
   * El menú se acota por rol.
   *
   * No reemplaza al control de acceso —cada acción sigue validando la sesión en
   * el servidor—, pero es lo que hace que quien opera la seccionadora no tenga
   * a la vista Cobros, Precios ni Migración. Un menú con veinte secciones de
   * las que solo tres son suyas no es un problema de permisos: es que no
   * encuentra la que necesita.
   */
  const visibles = secciones
    .map((seccion) => ({
      ...seccion,
      items: seccion.items.filter(
        (item) => !item.roles || !rol || item.roles.includes(rol),
      ),
    }))
    .filter((seccion) => seccion.items.length > 0);

  const contenido = (
    <>
      <Link
        href={inicioDelRol(rol ?? null)}
        className="flex items-center gap-2.5 px-[18px] pb-4 pt-[18px]"
        onClick={() => setAbierto(false)}
      >
        <Image
          src="/cropped-icon-180x180.png"
          alt=""
          width={34}
          height={34}
          className="rounded-lg"
        />
        <div className="leading-[1.25]">
          <p className="text-[15px] font-semibold">Maderera JBJ</p>
          <p className="text-[13px] text-texto-2">Panel de gestión</p>
        </div>
      </Link>

      <nav className="flex flex-1 flex-col gap-[18px] overflow-y-auto px-2.5 pb-3 pt-1">
        {visibles.map((seccion) => (
          <div key={seccion.titulo}>
            <p className="px-2 pb-1.5 text-xs font-semibold uppercase tracking-[0.09em] text-texto-3">
              {seccion.titulo}
            </p>
            <div className="flex flex-col gap-0.5">
              {seccion.items.map((item) => {
                const activo =
                  item.href === "/admin"
                    ? pathname === "/admin"
                    : pathname.startsWith(item.href);

                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setAbierto(false)}
                    aria-current={activo ? "page" : undefined}
                    className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2.5 text-[15px] transition-colors ${
                      activo
                        ? "nav-activa bg-card font-medium text-foreground shadow-[0_1px_2px_rgb(60_50_40_/_0.06)]"
                        : "text-texto-2 hover:bg-hundida hover:text-foreground"
                    }`}
                  >
                    <item.icon
                      className={`h-5 w-5 ${activo ? "text-brand-orange" : ""}`}
                    />
                    {item.label}
                    {"contador" in item &&
                      item.contador === "whatsapp" &&
                      whatsappSinLeer > 0 && (
                        <span
                          className="tabular ml-auto flex h-[22px] min-w-[22px] items-center justify-center rounded-full bg-verde-whatsapp px-1.5 text-[13px] font-semibold text-white"
                          aria-label={`${whatsappSinLeer} conversaciones sin leer`}
                        >
                          {whatsappSinLeer}
                        </span>
                      )}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* La ayuda va al pie y separada del resto: no es una sección del
          negocio, es a dónde se va cuando algo no se entiende. */}
      <Link
        href="/admin/ayuda"
        onClick={() => setAbierto(false)}
        aria-current={pathname.startsWith("/admin/ayuda") ? "page" : undefined}
        className={`mx-2.5 mb-1 flex items-center gap-2.5 rounded-lg px-2.5 py-2.5 text-[15px] transition-colors ${
          pathname.startsWith("/admin/ayuda")
            ? "nav-activa bg-card font-medium text-foreground shadow-[0_1px_2px_rgb(60_50_40_/_0.06)]"
            : "text-texto-2 hover:bg-hundida hover:text-foreground"
        }`}
      >
        <CircleQuestionMark
          className={`h-5 w-5 ${pathname.startsWith("/admin/ayuda") ? "text-brand-orange" : ""}`}
        />
        Ayuda
      </Link>

      <Link
        href="/"
        target="_blank"
        className="mx-2.5 mb-3 flex items-center justify-between rounded-lg px-2.5 py-2.5 text-sm text-texto-2 transition-colors hover:bg-hundida hover:text-foreground"
      >
        Ver el sitio público
        <ArrowUpRight className="h-4 w-4" />
      </Link>
    </>
  );

  return (
    <>
      {/* Escritorio */}
      <aside className="sticky top-0 hidden h-screen w-[244px] shrink-0 flex-col border-r border-linea bg-sidebar lg:flex">
        {contenido}
      </aside>

      {/* Móvil */}
      <button
        onClick={() => setAbierto(true)}
        className="fixed left-4 top-3.5 z-40 rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted lg:hidden"
        aria-label="Abrir menú"
      >
        <Menu className="h-5 w-5" />
      </button>

      {abierto && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            className="absolute inset-0 bg-foreground/20"
            onClick={() => setAbierto(false)}
            aria-label="Cerrar menú"
          />
          <aside className="relative flex h-full w-[244px] flex-col border-r border-linea bg-sidebar">
            <button
              onClick={() => setAbierto(false)}
              className="absolute right-3 top-4 rounded-lg p-1.5 text-muted-foreground hover:bg-muted"
              aria-label="Cerrar menú"
            >
              <X className="h-5 w-5" />
            </button>
            {contenido}
          </aside>
        </div>
      )}
    </>
  );
}
