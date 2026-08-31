"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { ThemeToggle } from "@/components/theme-toggle";
import { motion, AnimatePresence } from "framer-motion";
import {
  Menu,
  Phone,
  Clock,
  ChevronDown,
  ShoppingCart,
  Home,
  Layers,
  Grid3X3,
  Minus,
  Wrench,
  Footprints,
  Building,
  Umbrella,
  ArrowRight,
  UserRound,
  LayoutDashboard,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { useCarrito } from "@/lib/carrito-context";
import { primerNombre } from "@/lib/formato";

const productLinks = [
  { name: "Techos", href: "/catalogo?cat=techos", icon: Home, desc: "Tirantes, machimbres, aislantes" },
  { name: "Placas", href: "/catalogo?cat=placas", icon: Layers, desc: "Melaminas, MDF, fenólicos" },
  { name: "Pisos", href: "/catalogo?cat=pisos", icon: Grid3X3, desc: "Melamínicos Decno Flooring" },
  { name: "Molduras", href: "/catalogo?cat=molduras", icon: Minus, desc: "Marca Moldava - Finger Joint" },
  { name: "Ferretería", href: "/catalogo?cat=ferreteria", icon: Wrench, desc: "Herrajes y accesorios" },
  { name: "Decks y Escaleras", href: "/catalogo?cat=decks", icon: Footprints, desc: "Madera y PVC" },
  { name: "Construcción en Seco", href: "/catalogo?cat=construccion-seco", icon: Building, desc: "Durlock, perfiles, aislantes" },
  { name: "Cubiertas", href: "/catalogo?cat=cubiertas", icon: Umbrella, desc: "Chapas y tejas Curvin" },
];

/**
 * La navegación, en dos listas explícitas.
 *
 * Antes era una sola lista recortada con `slice(1, 5)` y `slice(5)`, lo que
 * ataba el menú al orden del arreglo: mover un elemento cambiaba en silencio
 * qué quedaba a la vista y qué se escondía en "Más". Ahora cada grupo se
 * declara.
 *
 * Calculadora y Stock salieron del chrome por pedido del cliente. Las rutas
 * siguen existiendo y enlazadas desde el inicio y el presupuesto.
 */
const enlacesDirectos = [
  { name: "Catálogo", href: "/catalogo" },
  { name: "Sucursales", href: "/sucursales" },
];

const enlacesMas = [
  { name: "Nosotros", href: "/nosotros" },
  { name: "Blog", href: "/blog" },
  { name: "Contacto", href: "/contacto" },
  { name: "Documentación", href: "/documentacion" },
  { name: "Eventos", href: "/eventos" },
];

/**
 * Quién está navegando, resuelto en el servidor por el layout.
 *
 * Llega como prop en vez de consultarse acá con un hook de cliente para que el
 * primer render ya salga con el estado correcto: pedirla desde el navegador
 * hace que "Ingresar" parpadee un instante para quien ya tiene la sesión
 * abierta.
 */
export interface SesionNavbar {
  nombre: string;
  esStaff: boolean;
}

export function Navbar({ sesion }: { sesion?: SesionNavbar | null }) {
  const [productsOpen, setProductsOpen] = useState(false);
  const [masOpen, setMasOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { cantidadItems } = useCarrito();

  const nombreDePila = sesion ? primerNombre(sesion.nombre) : "";
  const destinoSesion = sesion ? (sesion.esStaff ? "/admin" : "/mi-cuenta") : "/ingresar";
  const IconoSesion = sesion?.esStaff ? LayoutDashboard : UserRound;
  const textoSesion = sesion
    ? sesion.esStaff
      ? "Ir al panel"
      : "Mi cuenta"
    : "Ingresar";

  return (
    <>
      {/* Barra superior. Siempre oscura, en los dos temas. */}
      <div className="hidden bg-oscuro-marca text-[12.5px] text-white/70 sm:block">
        <div className="contenedor flex h-[38px] items-center gap-5">
          <span className="flex items-center gap-[7px]">
            <Phone className="h-[13px] w-[13px] text-brand-orange" />
            <span className="tabular">(0223) 474-3328</span>
          </span>
          <span className="hidden items-center gap-[7px] md:flex">
            <Clock className="h-[13px] w-[13px] text-brand-orange" />
            Lun-Vie 8:00-16:00 | Sáb 8:00-12:00
          </span>
          <div className="ml-auto flex items-center gap-3.5">
            <Link href="/profesionales" className="font-medium text-white/80 transition-colors hover:text-white">
              Portal Profesionales
            </Link>
            <span className="text-white/20">|</span>
            <Link href="/contacto" className="transition-colors hover:text-white">
              Contacto
            </Link>
            <span className="text-white/20">|</span>
            <Link
              href={destinoSesion}
              className="flex items-center gap-[7px] font-medium text-white transition-colors hover:text-brand-orange-light"
            >
              <IconoSesion className="h-[13px] w-[13px] text-brand-orange" />
              {sesion ? (sesion.esStaff ? "Panel" : `Hola, ${nombreDePila}`) : "Ingresar"}
            </Link>
          </div>
        </div>
      </div>

      {/* Barra principal */}
      <nav className="sticky top-0 z-50 border-b border-linea-suave bg-[var(--chrome-fondo)] backdrop-blur-[12px]">
        <div className="contenedor flex h-[72px] items-center gap-6">
          <Link href="/" className="group flex items-center gap-[11px]">
            <Image
              src="/cropped-icon-180x180.png"
              alt="Maderera Juan B. Justo"
              width={44}
              height={44}
              className="rounded-[11px] transition-transform duration-300 group-hover:scale-105"
            />
            <span className="hidden leading-[1.1] sm:block">
              <span className="block text-[15px] font-bold tracking-tight text-foreground">Maderera</span>
              <span className="block text-[11px] uppercase tracking-[0.11em] text-texto-3">Juan B. Justo</span>
            </span>
          </Link>

          <div className="hidden items-center gap-0.5 lg:flex">
            {/* Panel de productos */}
            <div
              className="relative"
              onMouseEnter={() => setProductsOpen(true)}
              onMouseLeave={() => setProductsOpen(false)}
            >
              <button
                className={`flex h-10 items-center gap-1.5 rounded-[9px] px-[13px] text-[14.5px] font-medium transition-colors ${
                  productsOpen ? "bg-sitio-alt text-acento-texto" : "text-foreground"
                }`}
                aria-expanded={productsOpen}
              >
                Productos
                <ChevronDown
                  className={`h-[15px] w-[15px] text-texto-3 transition-transform duration-200 ${
                    productsOpen ? "rotate-180" : ""
                  }`}
                />
              </button>
              <AnimatePresence>
                {productsOpen && (
                  <motion.div
                    initial={{ opacity: 0, y: 8, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 8, scale: 0.98 }}
                    transition={{ duration: 0.18 }}
                    className="absolute left-0 top-full z-[60] mt-2 w-[520px] max-w-[calc(100vw-2rem)] rounded-2xl border border-linea-suave bg-popover p-3 shadow-[0_24px_50px_-20px_rgb(60_50_40_/_0.4)]"
                  >
                    <div className="grid grid-cols-2 gap-1">
                      {productLinks.map((link) => (
                        <Link
                          key={link.href}
                          href={link.href}
                          className="group/item flex items-start gap-3 rounded-xl px-3 py-[11px] text-foreground transition-colors hover:bg-sitio-alt"
                        >
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-sitio-alt text-acento-texto transition-colors group-hover/item:bg-naranja-claro">
                            <link.icon className="h-[17px] w-[17px]" />
                          </span>
                          <span className="min-w-0">
                            <span className="block text-[14.5px] font-semibold">{link.name}</span>
                            <span className="block text-[12.5px] leading-[1.35] text-texto-3">{link.desc}</span>
                          </span>
                        </Link>
                      ))}
                    </div>
                    <div className="mt-2 border-t border-linea-tenue pt-2">
                      <Link
                        href="/catalogo"
                        className="flex items-center justify-between rounded-xl px-3 py-[11px] text-[14.5px] font-semibold text-acento-texto transition-colors hover:bg-naranja-tenue"
                      >
                        Ver catálogo completo
                        <ArrowRight className="h-4 w-4" />
                      </Link>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {enlacesDirectos.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="flex h-10 items-center rounded-[9px] px-[13px] text-[14.5px] font-medium text-foreground transition-colors hover:bg-sitio-alt hover:text-acento-texto"
              >
                {link.name}
              </Link>
            ))}

            <div
              className="relative"
              onMouseEnter={() => setMasOpen(true)}
              onMouseLeave={() => setMasOpen(false)}
            >
              <button
                className={`flex h-10 items-center gap-1.5 rounded-[9px] px-[13px] text-[14.5px] font-medium transition-colors ${
                  masOpen ? "bg-sitio-alt text-acento-texto" : "text-texto-2"
                }`}
                aria-expanded={masOpen}
              >
                Más
                <ChevronDown
                  className={`h-[15px] w-[15px] text-texto-3 transition-transform duration-200 ${
                    masOpen ? "rotate-180" : ""
                  }`}
                />
              </button>
              <AnimatePresence>
                {masOpen && (
                  <motion.div
                    initial={{ opacity: 0, y: 8, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 8, scale: 0.98 }}
                    transition={{ duration: 0.18 }}
                    className="absolute left-0 top-full z-[60] mt-2 w-[200px] rounded-xl border border-linea-suave bg-popover p-1.5 shadow-[0_18px_40px_-18px_rgb(60_50_40_/_0.4)]"
                  >
                    {enlacesMas.map((link) => (
                      <Link
                        key={link.href}
                        href={link.href}
                        className="block rounded-[9px] px-[11px] py-[9px] text-[14.5px] text-foreground transition-colors hover:bg-sitio-alt hover:text-acento-texto"
                      >
                        {link.name}
                      </Link>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>

          {/* Acciones */}
          <div className="ml-auto flex items-center gap-2">
            <ThemeToggle />

            <Link
              href={destinoSesion}
              className={`hidden h-11 items-center gap-2 rounded-[11px] border border-linea px-[15px] text-[14.5px] font-semibold transition-colors hover:bg-sitio-alt md:flex ${
                sesion ? "text-acento-texto" : "text-foreground"
              }`}
            >
              <IconoSesion className="h-[18px] w-[18px]" />
              <span>{textoSesion}</span>
            </Link>

            <Link
              href="/presupuesto"
              aria-label={
                cantidadItems > 0
                  ? `Tu presupuesto, ${cantidadItems} ${cantidadItems === 1 ? "ítem" : "ítems"}`
                  : "Tu presupuesto"
              }
              className="relative flex h-10 w-10 items-center justify-center rounded-[11px] text-texto-2 transition-colors hover:bg-sitio-alt hover:text-acento-texto"
            >
              <ShoppingCart className="h-[19px] w-[19px]" />
              {cantidadItems > 0 && (
                <span className="tabular absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-accion px-[5px] text-[11px] font-bold text-white">
                  {cantidadItems}
                </span>
              )}
            </Link>

            <Link
              href="/presupuesto"
              className="hidden h-11 items-center rounded-full bg-accion px-5 text-[15px] font-semibold text-white shadow-[0_4px_14px_-6px_rgb(194_87_15_/_0.6)] transition-colors hover:bg-accion-hover md:flex"
            >
              Pedir Presupuesto
            </Link>

            {/* Menú del teléfono */}
            <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
              <SheetTrigger className="inline-flex h-10 w-10 items-center justify-center rounded-[11px] transition-colors hover:bg-sitio-alt lg:hidden">
                <Menu className="h-5 w-5" />
              </SheetTrigger>
              <SheetContent side="right" className="w-80">
                <div className="mt-8 flex flex-col gap-1">
                  {/* La cuenta va arriba de todo en el teléfono: es lo que se
                      busca cuando el pedido ya está hecho. */}
                  <Link
                    href={destinoSesion}
                    onClick={() => setMobileMenuOpen(false)}
                    className="mb-3 flex items-center gap-3 rounded-xl bg-sitio-alt px-3 py-3 text-sm font-medium"
                  >
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-naranja-claro">
                      <IconoSesion className="h-4 w-4 text-acento-texto" />
                    </span>
                    {sesion
                      ? sesion.esStaff
                        ? "Ir al panel"
                        : `Mi cuenta · ${nombreDePila}`
                      : "Ingresar o crear cuenta"}
                  </Link>

                  <p className="mb-2 px-3 text-[10px] font-bold uppercase tracking-[0.15em] text-texto-3">
                    Productos
                  </p>
                  {productLinks.map((link) => (
                    <Link
                      key={link.href}
                      href={link.href}
                      onClick={() => setMobileMenuOpen(false)}
                      className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm hover:bg-sitio-alt"
                    >
                      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-naranja-claro">
                        <link.icon className="h-4 w-4 text-acento-texto" />
                      </span>
                      {link.name}
                    </Link>
                  ))}

                  <div className="my-3 border-t border-linea-tenue" />
                  <p className="mb-2 px-3 text-[10px] font-bold uppercase tracking-[0.15em] text-texto-3">
                    Navegación
                  </p>
                  {[...enlacesDirectos, { name: "Portal Profesionales", href: "/profesionales" }, ...enlacesMas].map(
                    (link) => (
                      <Link
                        key={link.href}
                        href={link.href}
                        onClick={() => setMobileMenuOpen(false)}
                        className="rounded-xl px-3 py-2.5 text-sm font-medium hover:bg-sitio-alt"
                      >
                        {link.name}
                      </Link>
                    ),
                  )}

                  <div className="my-3 border-t border-linea-tenue" />
                  <Link href="/presupuesto" onClick={() => setMobileMenuOpen(false)}>
                    <Button className="w-full rounded-full bg-accion font-semibold text-white hover:bg-accion-hover">
                      Pedir Presupuesto
                    </Button>
                  </Link>
                </div>
              </SheetContent>
            </Sheet>
          </div>
        </div>
      </nav>
    </>
  );
}
