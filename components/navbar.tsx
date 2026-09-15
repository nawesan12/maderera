"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import Image from "next/image";
import { ThemeToggle } from "@/components/theme-toggle";
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
  Scissors,
  Calculator,
  Warehouse,
  MessageCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { useCarrito } from "@/lib/carrito-context";
import { useEstado } from "@/lib/estado-context";
import { primerNombre, telefonoParaMarcar } from "@/lib/formato";

const productLinks = [
  { name: "Techos", slug: "techos", icon: Home, desc: "Tirantes, machimbres, aislantes" },
  { name: "Placas", slug: "placas", icon: Layers, desc: "Melaminas, MDF, fenólicos" },
  { name: "Pisos", slug: "pisos", icon: Grid3X3, desc: "Melamínicos Decno Flooring" },
  {
    name: "Molduras",
    slug: "molduras",
    icon: Minus,
    desc: "Finger Joint, fabricadas acá",
    // La única línea que sale del aserradero propio. La clienta pidió que
    // Moldava se note; acá se nota sin ocupar un renglón más.
    propia: true,
  },
  { name: "Ferretería", slug: "ferreteria", icon: Wrench, desc: "Herrajes y accesorios" },
  { name: "Decks y Escaleras", slug: "decks-y-escaleras", icon: Footprints, desc: "Madera y PVC" },
  { name: "Construcción en Seco", slug: "construccion-en-seco", icon: Building, desc: "Durlock, perfiles, aislantes" },
  { name: "Cubiertas", slug: "cubiertas", icon: Umbrella, desc: "Chapas y tejas Curvin" },
];

/**
 * Lo que la maderera hace, que no es un rubro del catálogo.
 *
 * El desplegable listaba ocho rubros y nada más: ocho filas del mismo peso,
 * sin nada que ayudara a decidir. Quien entra al menú de una maderera muchas
 * veces no viene a buscar "placas" sino a resolver algo —cortar, calcular
 * cuánto lleva, ver si hay stock— y eso no estaba en ningún lado del menú.
 */
const herramientas = [
  {
    name: "Corte a medida",
    href: "/presupuesto",
    icon: Scissors,
    desc: "Mandá el despiece en milímetros",
  },
  {
    name: "Calculadora",
    href: "/calculadora",
    icon: Calculator,
    desc: "Cuánto material lleva tu obra",
  },
  {
    name: "Stock en sucursal",
    href: "/stock",
    icon: Warehouse,
    desc: "Qué hay hoy, antes de venir",
  },
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
  // Moldava salió de "Más" a la barra: es la marca propia, y la clienta pidió
  // darle mucha más presencia. Escondida detrás de un desplegable no la
  // encontraba nadie.
  { name: "Moldava", href: "/moldava" },
  // Profesionales también sube a la barra (tercera tanda): estaba solo en la
  // barra superior, que en el teléfono ni existe, y la clienta pidió que la
  // cuenta profesional se encuentre sin buscarla.
  { name: "Profesionales", href: "/profesionales" },
  { name: "Sucursales", href: "/sucursales" },
];

/*
 * "Catálogo" no está en esta lista y no es un olvido.
 *
 * Estaba, y llevaba al mismo `/catalogo` que "Productos", que está justo al
 * lado: dos botones pegados con el mismo destino. El que quedó es "Productos",
 * que además abre las ocho categorías y tiene adentro "Ver catálogo completo".
 */

const enlacesMas = [
  { name: "Nosotros", href: "/nosotros" },
  { name: "Documentación", href: "/documentacion" },
  { name: "Eventos", href: "/eventos" },
  // La calculadora vuelve a tener lugar en el menú, sin ocupar la barra: salió
  // de ahí a pedido de la clienta y quedó sin ninguna puerta de entrada.
  { name: "Calculadora", href: "/calculadora" },
];

/**
 * Quién está navegando.
 *
 * Ya no llega del servidor: las páginas públicas se sirven del CDN, con el
 * mismo HTML para todo el mundo, así que el nombre lo completa el navegador
 * con `useEstado()`. El costo es visible y conocido —para quien tiene la
 * sesión abierta, el menú dice "Ingresar" durante un instante antes de decir
 * su nombre— y es lo que se paga a cambio de que la página no se arme en el
 * servidor en cada visita.
 *
 * Mientras no se sabe, el menú muestra el lado de afuera. Es la opción segura:
 * de más nunca, de menos por un momento.
 */
export interface SesionNavbar {
  nombre: string;
  esStaff: boolean;
}

/**
 * El teléfono y el horario bajan por prop desde el layout, que los lee de Casa
 * Central. Estuvieron escritos a mano acá y por eso corregir el teléfono en el
 * panel lo dejaba viejo en la barra superior de todas las páginas: el dato de
 * contacto tiene una sola fuente, que es la ficha de la sucursal.
 */
export function Navbar({
  telefono,
  horario,
  whatsapp,
  productosPorRubro = {},
}: {
  telefono?: string | null;
  horario?: string | null;
  /** El enlace armado, que sale del número cargado en el panel. */
  whatsapp?: string | null;
  /** Cuántos productos activos tiene cada rubro, por slug. */
  productosPorRubro?: Record<string, number>;
}) {
  const pathname = usePathname();

  /*
   * En qué sección está parado.
   *
   * El menú no lo decía: se navegaba a Sucursales y la barra seguía viéndose
   * igual que en la portada. `aria-current` es además lo que un lector de
   * pantalla anuncia como "página actual".
   */
  const enSeccion = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  const [productsOpen, setProductsOpen] = useState(false);
  const [masOpen, setMasOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { cantidadItems } = useCarrito();
  const { sesion } = useEstado();

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
          {telefono && (
            <a
              href={`tel:${telefonoParaMarcar(telefono)}`}
              className="flex items-center gap-[7px] transition-colors hover:text-white"
            >
              <Phone className="h-[13px] w-[13px] text-brand-orange" />
              <span className="tabular">{telefono}</span>
            </a>
          )}
          {horario && (
            <span className="hidden items-center gap-[7px] md:flex">
              <Clock className="h-[13px] w-[13px] text-brand-orange" />
              {horario}
            </span>
          )}
          {/*
            Arriba va cómo comunicarse, y nada más.
            Tenía además "Portal Profesionales" y la sesión, que están los dos
            en la barra de abajo apuntando al mismo lugar: el mismo destino dos
            veces en la misma pantalla no es dar más opciones, es hacer dudar
            cuál de las dos es.
          */}
          <div className="ml-auto flex items-center gap-3.5">
            <Link
              href="/contacto"
              className="uppercase tracking-[0.07em] transition-colors hover:text-white"
            >
              Contacto
            </Link>
            {whatsapp && (
              <>
                <span className="text-white/20">|</span>
                <a
                  href={whatsapp}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium uppercase tracking-[0.07em] text-white/80 transition-colors hover:text-white"
                >
                  WhatsApp
                </a>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Barra principal */}
      <nav className="sticky top-0 z-50 border-b border-linea-suave bg-[var(--chrome-fondo)] backdrop-blur-[12px]">
        <div className="contenedor flex h-[72px] items-center gap-6">
          {/* El logo, más grande y con el nombre siempre a la vista: la
              clienta pidió que tenga más presencia y que nunca se pierda. */}
          <Link href="/" className="group flex items-center gap-3">
            <Image
              src="/cropped-icon-180x180.png"
              alt="Maderera Juan B. Justo"
              width={54}
              height={54}
              className="rounded-[13px] transition-transform duration-300 group-hover:scale-105"
            />
            <span className="leading-[1.1]">
              <span className="block text-[17px] font-extrabold tracking-tight text-foreground">Maderera</span>
              <span className="block text-[12px] font-semibold uppercase tracking-[0.11em] text-texto-3">Juan B. Justo</span>
            </span>
          </Link>

          <div className="hidden items-center gap-0.5 lg:flex">
            {/* Panel de productos */}
            {/*
              El desplegable abría solo al pasar el mouse por encima. Con el
              teclado no había forma de ver las ocho categorías: se tabulaba
              sobre "Productos" y no pasaba nada. Ahora también abre al recibir
              el foco, se cierra con Escape y se cierra al salir del grupo, que
              es lo que un menú tiene que hacer para ser navegable sin mouse.
            */}
            <div
              className="relative"
              onMouseEnter={() => setProductsOpen(true)}
              onMouseLeave={() => setProductsOpen(false)}
              onFocus={() => setProductsOpen(true)}
              onBlur={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                  setProductsOpen(false);
                }
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape" && productsOpen) {
                  e.stopPropagation();
                  setProductsOpen(false);
                }
              }}
            >
              {/* Es un enlace y no un botón: antes solo abría el desplegable
                  al pasar por encima, así que en un teléfono —donde no hay
                  hover— "Productos" no llevaba a ninguna parte. La clienta
                  pidió darle más presencia al catálogo; empezar por hacerlo
                  clicable es lo mínimo. */}
              <Link
                href="/catalogo"
                className={`relative flex h-10 items-center gap-1.5 rounded-[9px] px-[11px] text-[13.5px] font-bold uppercase tracking-[0.04em] transition-colors ${
                  productsOpen || enSeccion("/catalogo")
                    ? "bg-sitio-alt text-acento-texto"
                    : "text-foreground"
                } ${
                  enSeccion("/catalogo")
                    ? "after:absolute after:inset-x-[11px] after:-bottom-[1px] after:h-[2px] after:rounded-full after:bg-accion"
                    : ""
                }`}
                aria-current={enSeccion("/catalogo") ? "page" : undefined}
                aria-expanded={productsOpen}
              >
                Productos
                <ChevronDown
                  className={`h-[15px] w-[15px] text-texto-3 transition-transform duration-200 ${
                    productsOpen ? "rotate-180" : ""
                  }`}
                />
              </Link>
              {/* El desplegable entra con una animación de CSS. La salida no se
                  anima: dura 180 ms, se dispara al sacar el mouse y nadie la
                  mira, y mantenerla era el único motivo para tener montada una
                  librería de animación en todas las páginas del sitio. */}
              {productsOpen && (
                <div className="absolute left-0 top-full z-[60] mt-2 flex w-[760px] max-w-[calc(100vw-2rem)] animate-in overflow-hidden rounded-2xl border border-linea-suave bg-popover shadow-[0_24px_50px_-20px_rgb(60_50_40_/_0.4)] duration-200 fade-in slide-in-from-top-2 motion-reduce:animate-none">
                  {/* Lo que se vende */}
                  <div className="min-w-0 flex-1 p-3">
                    <p className="px-3 pb-2 pt-1 text-[10.5px] font-bold uppercase tracking-[0.14em] text-texto-3">
                      Rubros
                    </p>
                    <div className="entra-en-orden grid grid-cols-2 gap-0.5">
                      {productLinks.map((link, i) => {
                        const cuantos = productosPorRubro[link.slug];
                        return (
                          <Link
                            key={link.slug}
                            href={`/catalogo?cat=${link.slug}`}
                            style={{ "--i": i } as React.CSSProperties}
                            className="group/item flex items-start gap-3 rounded-xl px-3 py-[11px] text-foreground transition-colors hover:bg-sitio-alt"
                          >
                            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-sitio-alt text-acento-texto transition-colors group-hover/item:bg-naranja-claro">
                              <link.icon className="h-[17px] w-[17px]" />
                            </span>
                            <span className="min-w-0">
                              <span className="flex items-center gap-1.5">
                                <span className="text-[13px] font-bold uppercase tracking-[0.045em]">
                                  {link.name}
                                </span>
                                {/* La línea propia, dicha una sola vez y donde
                                    corresponde. */}
                                {"propia" in link && link.propia && (
                                  <span className="rounded-full bg-naranja-claro px-1.5 py-px text-[10px] font-bold uppercase tracking-[0.06em] text-acento-sobre-claro">
                                    Moldava
                                  </span>
                                )}
                              </span>
                              <span className="block text-[12.5px] leading-[1.35] text-texto-3">
                                {link.desc}
                              </span>
                              {/* El número sale de la base y no está escrito a
                                  mano: dice qué rubro tiene fondo de verdad. */}
                              {cuantos !== undefined && cuantos > 0 && (
                                <span className="tabular mt-0.5 block text-[11.5px] text-texto-3">
                                  {cuantos} {cuantos === 1 ? "producto" : "productos"}
                                </span>
                              )}
                            </span>
                          </Link>
                        );
                      })}
                    </div>

                    <div className="mt-1.5 border-t border-linea-tenue pt-1.5">
                      <Link
                        href="/catalogo"
                        className="group/todo flex items-center justify-between rounded-xl px-3 py-[11px] text-[13px] font-bold uppercase tracking-[0.045em] text-acento-texto transition-colors hover:bg-naranja-tenue"
                      >
                        Ver todo el catálogo
                        <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover/todo:translate-x-1" />
                      </Link>
                    </div>
                  </div>

                  {/*
                    Lo que la maderera hace.
                    Va en su propia columna y sobre otra superficie porque no es
                    más de lo mismo: son las tres cosas que alguien viene a
                    resolver y que antes no estaban en el menú.
                  */}
                  <div className="flex w-[264px] shrink-0 flex-col border-l border-linea-tenue bg-sitio-alt p-3">
                    <p className="px-3 pb-2 pt-1 text-[10.5px] font-bold uppercase tracking-[0.14em] text-texto-3">
                      Y además
                    </p>
                    <div className="entra-en-orden space-y-0.5">
                      {herramientas.map((h, i) => (
                        <Link
                          key={h.href}
                          href={h.href}
                          style={{ "--i": i + 2 } as React.CSSProperties}
                          className="group/h flex items-start gap-3 rounded-xl px-3 py-[11px] transition-colors hover:bg-card"
                        >
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-card text-acento-texto transition-colors group-hover/h:bg-naranja-claro">
                            <h.icon className="h-[17px] w-[17px]" />
                          </span>
                          <span className="min-w-0">
                            <span className="block text-[13px] font-bold uppercase tracking-[0.045em] text-foreground">
                              {h.name}
                            </span>
                            <span className="block text-[12.5px] leading-[1.35] text-texto-3">
                              {h.desc}
                            </span>
                          </span>
                        </Link>
                      ))}
                    </div>

                    {/* Al pie de la columna, la salida para quien no sabe qué
                        pedir: en una maderera es media clientela, y hasta acá
                        el menú solo servía a quien ya sabía el nombre del
                        material. */}
                    {whatsapp && (
                      <a
                        href={whatsapp}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="group/ayuda mt-auto flex items-center gap-3 rounded-xl border border-linea-suave bg-card px-3 py-3 transition-colors hover:border-accion/40"
                      >
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-[#25D366]/12 text-[#128C4A]">
                          <MessageCircle className="h-[17px] w-[17px]" />
                        </span>
                        <span className="min-w-0">
                          <span className="block text-[13.5px] font-semibold text-foreground">
                            ¿No sabés qué llevar?
                          </span>
                          <span className="block text-[12px] leading-[1.35] text-texto-3">
                            Contanos la obra por WhatsApp
                          </span>
                        </span>
                      </a>
                    )}
                  </div>
                </div>
                )}
            </div>

            {/* En imprenta mayúscula y con más cuerpo, por pedido de la
                clienta: "que todas las del menú sean en imprenta mayúsculas". */}
            {enlacesDirectos.map((link) => {
              const activa = enSeccion(link.href);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  aria-current={activa ? "page" : undefined}
                  className={`relative flex h-10 items-center rounded-[9px] px-[11px] text-[13.5px] font-bold uppercase tracking-[0.04em] transition-colors hover:bg-sitio-alt hover:text-acento-texto ${
                    activa
                      ? "text-acento-texto after:absolute after:inset-x-[11px] after:-bottom-[1px] after:h-[2px] after:rounded-full after:bg-accion"
                      : "text-foreground"
                  }`}
                >
                  {link.name}
                </Link>
              );
            })}

            <div
              className="relative"
              onFocus={() => setMasOpen(true)}
              onBlur={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                  setMasOpen(false);
                }
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape" && masOpen) {
                  e.stopPropagation();
                  setMasOpen(false);
                }
              }}
              onMouseEnter={() => setMasOpen(true)}
              onMouseLeave={() => setMasOpen(false)}
            >
              <button
                className={`flex h-10 items-center gap-1.5 rounded-[9px] px-[11px] text-[13.5px] font-bold uppercase tracking-[0.04em] transition-colors ${
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
              {masOpen && (
                  <div
                    className="entra-en-orden absolute left-0 top-full z-[60] mt-2 w-[200px] animate-in rounded-xl border border-linea-suave bg-popover p-1.5 shadow-[0_18px_40px_-18px_rgb(60_50_40_/_0.4)] duration-200 fade-in slide-in-from-top-2 motion-reduce:animate-none"
                  >
                    {enlacesMas.map((link, i) => (
                      <Link
                        key={link.href}
                        href={link.href}
                        style={{ "--i": i } as React.CSSProperties}
                        className="block rounded-[9px] px-[11px] py-[9px] text-[13px] font-semibold uppercase tracking-[0.045em] text-foreground transition-colors hover:bg-sitio-alt hover:text-acento-texto"
                      >
                        {link.name}
                      </Link>
                    ))}
                  </div>
                )}
            </div>
          </div>

          {/* Acciones */}
          <div className="ml-auto flex items-center gap-2">
            <ThemeToggle />

            <Link
              href={destinoSesion}
              className={`hidden h-11 items-center gap-2 whitespace-nowrap rounded-[11px] border border-linea px-[15px] text-[14.5px] font-semibold transition-colors hover:bg-sitio-alt md:flex ${
                sesion ? "text-acento-texto" : "text-foreground"
              }`}
            >
              <IconoSesion className="h-[18px] w-[18px]" />
              <span>{textoSesion}</span>
            </Link>

            {/* Crear cuenta, solo a quien no entró. La clienta pidió promover
                más el registro: en el escritorio no había ni un enlace, solo
                "Ingresar", que a quien todavía no tiene cuenta no le dice que
                pueda hacerse una. Desde `xl` y no `lg`: con Profesionales en la
                barra, en 1024 px ya no entran las dos cosas. */}
            {!sesion && (
              <Link
                href="/registro"
                className="hidden h-11 items-center whitespace-nowrap rounded-[11px] px-[13px] text-[14.5px] font-semibold text-acento-texto transition-colors hover:bg-sitio-alt xl:flex"
              >
                Crear cuenta
              </Link>
            )}

            <Link
              href="/presupuesto"
              aria-label={
                cantidadItems > 0
                  ? `Tu presupuesto, ${cantidadItems} ${cantidadItems === 1 ? "producto" : "productos"}`
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
              className="hidden h-11 items-center whitespace-nowrap rounded-full bg-accion px-5 text-[15px] font-semibold text-white shadow-[0_4px_14px_-6px_rgb(194_87_15_/_0.6)] transition-colors hover:bg-accion-hover md:flex"
            >
              Pedir Presupuesto
            </Link>

            {/* Menú del teléfono */}
            <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
              <SheetTrigger className="inline-flex h-10 w-10 items-center justify-center rounded-[11px] transition-colors hover:bg-sitio-alt lg:hidden">
                <Menu className="h-5 w-5" />
              </SheetTrigger>
              <SheetContent side="right" className="w-80">
                {/* El panel es `h-full` y no crece: sin un hijo que pueda
                    encoger y desbordar por su cuenta, la lista quedaba cortada
                    abajo y no había forma de llegar a "Pedir Presupuesto" en
                    una pantalla de teléfono. `min-h-0` es lo que habilita el
                    encogido dentro de un contenedor flex; sin eso, el
                    `overflow-y-auto` no tiene efecto. */}
                <div className="mt-8 flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto overscroll-contain pb-8">
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
                  {productLinks.map((link) => {
                    const cuantos = productosPorRubro[link.slug];
                    return (
                      <Link
                        key={link.slug}
                        href={`/catalogo?cat=${link.slug}`}
                        onClick={() => setMobileMenuOpen(false)}
                        className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm hover:bg-sitio-alt"
                      >
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-naranja-claro">
                          <link.icon className="h-4 w-4 text-acento-texto" />
                        </span>
                        <span className="min-w-0 flex-1">{link.name}</span>
                        {cuantos !== undefined && cuantos > 0 && (
                          <span className="tabular shrink-0 text-[12px] text-texto-3">
                            {cuantos}
                          </span>
                        )}
                      </Link>
                    );
                  })}

                  <Link
                    href="/catalogo"
                    onClick={() => setMobileMenuOpen(false)}
                    className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-acento-texto hover:bg-sitio-alt"
                  >
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-naranja-claro">
                      <ArrowRight className="h-4 w-4" />
                    </span>
                    Ver todo el catálogo
                  </Link>

                  <div className="my-3 border-t border-linea-tenue" />
                  <p className="mb-2 px-3 text-[10px] font-bold uppercase tracking-[0.15em] text-texto-3">
                    Y además
                  </p>
                  {herramientas.map((h) => (
                    <Link
                      key={h.href}
                      href={h.href}
                      onClick={() => setMobileMenuOpen(false)}
                      className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm hover:bg-sitio-alt"
                    >
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-sitio-alt">
                        <h.icon className="h-4 w-4 text-acento-texto" />
                      </span>
                      {h.name}
                    </Link>
                  ))}

                  <div className="my-3 border-t border-linea-tenue" />
                  <p className="mb-2 px-3 text-[10px] font-bold uppercase tracking-[0.15em] text-texto-3">
                    Navegación
                  </p>
                  {[...enlacesDirectos, ...enlacesMas].map((link) => {
                    const activa = enSeccion(link.href);
                    return (
                      <Link
                        key={link.href}
                        href={link.href}
                        onClick={() => setMobileMenuOpen(false)}
                        aria-current={activa ? "page" : undefined}
                        className={`rounded-xl px-3 py-2.5 text-sm font-medium hover:bg-sitio-alt ${
                          activa ? "bg-sitio-alt text-acento-texto" : ""
                        }`}
                      >
                        {link.name}
                      </Link>
                    );
                  })}

                  <div className="my-3 border-t border-linea-tenue" />
                  <Link href="/presupuesto" onClick={() => setMobileMenuOpen(false)}>
                    <Button className="w-full rounded-full bg-accion font-semibold text-white hover:bg-accion-hover">
                      Pedir Presupuesto
                    </Button>
                  </Link>

                  {/* Crear cuenta también acá. En la barra de arriba solo
                      aparece desde `xl`, así que en celular y en tablet —que
                      es donde entra la mayoría— no había un solo enlace para
                      registrarse en todo el sitio. */}
                  {!sesion && (
                    <Link
                      href="/registro"
                      onClick={() => setMobileMenuOpen(false)}
                      className="mt-2 rounded-xl px-3 py-2.5 text-center text-sm font-semibold text-acento-texto hover:bg-sitio-alt"
                    >
                      Crear una cuenta
                    </Link>
                  )}
                </div>
              </SheetContent>
            </Sheet>
          </div>
        </div>
      </nav>
    </>
  );
}
