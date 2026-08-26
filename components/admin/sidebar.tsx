"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  ArrowUpRight,
  BookOpen,
  Boxes,
  CalendarDays,
  Tags,
  Building2,
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
  Mail,
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
const secciones = [
  {
    titulo: "Operación",
    items: [
      { href: "/admin", icon: LayoutDashboard, label: "Resumen" },
      { href: "/admin/pedidos", icon: Truck, label: "Pedidos" },
      {
        href: "/admin/whatsapp",
        icon: MessageCircle,
        label: "WhatsApp",
        contador: "whatsapp" as const,
      },
      { href: "/admin/presupuestos", icon: ClipboardList, label: "Presupuestos" },
      { href: "/admin/cortes", icon: Scissors, label: "Cortes" },
    ],
  },
  {
    titulo: "Catálogo",
    items: [
      { href: "/admin/productos", icon: Boxes, label: "Productos" },
      { href: "/admin/stock", icon: Package, label: "Stock" },
      { href: "/admin/precios", icon: Tags, label: "Precios" },
    ],
  },
  {
    titulo: "Administración",
    items: [
      { href: "/admin/clientes", icon: Users, label: "Clientes" },
      { href: "/admin/profesionales", icon: HardHat, label: "Profesionales" },
      { href: "/admin/documentacion", icon: BookOpen, label: "Documentación" },
      { href: "/admin/contenido", icon: Newspaper, label: "Contenido" },
      { href: "/admin/eventos", icon: CalendarDays, label: "Eventos" },
      { href: "/admin/pagos", icon: Wallet, label: "Cobros" },
      { href: "/admin/facturacion", icon: FileText, label: "Facturación" },
      { href: "/admin/arca", icon: Landmark, label: "ARCA" },
      { href: "/admin/avisos", icon: Mail, label: "Avisos" },
      { href: "/admin/sucursales", icon: Building2, label: "Sucursales" },
    ],
  },
];

export function AdminSidebar({
  whatsappSinLeer = 0,
}: {
  whatsappSinLeer?: number;
}) {
  const pathname = usePathname();
  const [abierto, setAbierto] = useState(false);

  const contenido = (
    <>
      <Link
        href="/admin"
        className="flex items-center gap-2.5 px-5 py-5"
        onClick={() => setAbierto(false)}
      >
        <Image
          src="/cropped-icon-180x180.png"
          alt=""
          width={34}
          height={34}
          className="rounded-lg"
        />
        <div className="leading-tight">
          <p className="text-base font-semibold">Maderera JBJ</p>
          <p className="text-sm text-muted-foreground">Panel de gestión</p>
        </div>
      </Link>

      <nav className="flex-1 space-y-6 px-3 pb-4">
        {secciones.map((seccion) => (
          <div key={seccion.titulo}>
            <p className="px-2 pb-1.5 text-sm font-semibold uppercase tracking-[0.08em] text-muted-foreground/70">
              {seccion.titulo}
            </p>
            <div className="space-y-0.5">
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
                    className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2.5 text-base transition-colors ${
                      activo
                        ? "nav-activa bg-muted font-medium text-foreground"
                        : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
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
                          className="tabular ml-auto flex h-6 min-w-6 items-center justify-center rounded-full bg-brand-green px-1.5 text-sm font-semibold text-white"
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

      <Link
        href="/"
        target="_blank"
        className="mx-3 mb-4 flex items-center justify-between rounded-lg px-2 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
      >
        Ver el sitio público
        <ArrowUpRight className="h-4 w-4" />
      </Link>
    </>
  );

  return (
    <>
      {/* Escritorio */}
      <aside className="hidden w-64 shrink-0 flex-col border-r bg-sidebar lg:flex">
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
          <aside className="relative flex h-full w-64 flex-col border-r bg-sidebar">
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
