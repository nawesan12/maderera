"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { motion, AnimatePresence } from "framer-motion";
import {
  Menu,
  Phone,
  Clock,
  ChevronDown,
  ShoppingCart,
  Calculator,
  Home,
  Layers,
  Grid3X3,
  Minus,
  Wrench,
  Footprints,
  Building,
  Umbrella,
  ArrowRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { useBudget } from "@/lib/budget-context";

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

const navLinks = [
  { name: "Catálogo", href: "/catalogo" },
  { name: "Calculadora", href: "/calculadora" },
  { name: "Stock", href: "/stock" },
  { name: "Sucursales", href: "/sucursales" },
  { name: "Profesionales", href: "/profesionales" },
  { name: "Nosotros", href: "/nosotros" },
  { name: "Blog", href: "/blog" },
  { name: "Contacto", href: "/contacto" },
];

export function Navbar() {
  const [productsOpen, setProductsOpen] = useState(false);
  const { totalItems } = useBudget();

  return (
    <>
      {/* Top bar - Dark, subtle */}
      <div className="bg-brand-gray text-white/70 text-xs py-2 hidden sm:block">
        <div className="container mx-auto px-4 flex items-center justify-between">
          <div className="flex items-center gap-5">
            <span className="flex items-center gap-1.5">
              <Phone className="h-3 w-3 text-brand-orange" />
              (0223) 474-3328
            </span>
            <span className="flex items-center gap-1.5">
              <Clock className="h-3 w-3 text-brand-orange" />
              Lun-Vie 8:00-16:00 | Sáb 8:00-12:00
            </span>
          </div>
          <div className="flex items-center gap-4">
            <Link href="/profesionales" className="hover:text-white transition-colors font-medium">
              Portal Profesionales
            </Link>
            <span className="text-white/20">|</span>
            <Link href="/contacto" className="hover:text-white transition-colors">
              Contacto
            </Link>
          </div>
        </div>
      </div>

      {/* Main nav */}
      <nav className="sticky top-0 z-50 bg-white/95 backdrop-blur-xl border-b border-border/50">
        <div className="container mx-auto px-4">
          <div className="flex items-center justify-between h-[72px]">
            {/* Logo */}
            <Link href="/" className="flex items-center gap-3 group">
              <Image
                src="/cropped-icon-180x180.png"
                alt="Maderera Juan B. Justo"
                width={44}
                height={44}
                className="rounded-xl group-hover:scale-105 transition-transform duration-300"
              />
              <div className="hidden sm:block">
                <p className="font-bold text-foreground leading-tight text-[15px] tracking-tight">Maderera</p>
                <p className="text-[11px] text-muted-foreground leading-tight tracking-wide uppercase">Juan B. Justo</p>
              </div>
            </Link>

            {/* Desktop nav */}
            <div className="hidden lg:flex items-center gap-0.5">
              {/* Products mega dropdown */}
              <div
                className="relative"
                onMouseEnter={() => setProductsOpen(true)}
                onMouseLeave={() => setProductsOpen(false)}
              >
                <button className="flex items-center gap-1 px-3.5 py-2 text-sm font-medium text-foreground hover:text-brand-orange transition-colors rounded-lg">
                  Productos
                  <ChevronDown className={`h-3.5 w-3.5 transition-transform duration-200 ${productsOpen ? "rotate-180" : ""}`} />
                </button>
                <AnimatePresence>
                  {productsOpen && (
                    <motion.div
                      initial={{ opacity: 0, y: 8, scale: 0.98 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: 8, scale: 0.98 }}
                      transition={{ duration: 0.18 }}
                      className="absolute top-full left-1/2 -translate-x-1/2 w-[520px] bg-white rounded-2xl shadow-2xl border p-3 mt-2"
                    >
                      <div className="grid grid-cols-2 gap-1">
                        {productLinks.map((link) => (
                          <Link
                            key={link.href}
                            href={link.href}
                            className="flex items-start gap-3 px-3 py-3 rounded-xl hover:bg-brand-cream text-foreground hover:text-brand-orange transition-colors group/item"
                          >
                            <div className="w-9 h-9 rounded-lg bg-brand-cream group-hover/item:bg-brand-orange/10 flex items-center justify-center shrink-0 mt-0.5 transition-colors">
                              <link.icon className="h-4 w-4 text-brand-orange" />
                            </div>
                            <div>
                              <p className="text-sm font-medium">{link.name}</p>
                              <p className="text-xs text-muted-foreground">{link.desc}</p>
                            </div>
                          </Link>
                        ))}
                      </div>
                      <div className="border-t mt-2 pt-2">
                        <Link
                          href="/catalogo"
                          className="flex items-center justify-between px-3 py-2.5 rounded-xl hover:bg-brand-orange/5 text-sm font-semibold text-brand-orange"
                        >
                          Ver catálogo completo
                          <ArrowRight className="h-4 w-4" />
                        </Link>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {navLinks.slice(1, 5).map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className="px-3.5 py-2 text-sm font-medium text-foreground hover:text-brand-orange transition-colors rounded-lg"
                >
                  {link.name}
                </Link>
              ))}

              {/* More dropdown for secondary links */}
              <div className="relative group">
                <button className="flex items-center gap-1 px-3.5 py-2 text-sm font-medium text-muted-foreground hover:text-brand-orange transition-colors rounded-lg">
                  Más
                  <ChevronDown className="h-3.5 w-3.5" />
                </button>
                <div className="absolute top-full right-0 w-48 bg-white rounded-xl shadow-xl border p-1.5 mt-2 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200">
                  {navLinks.slice(5).map((link) => (
                    <Link
                      key={link.href}
                      href={link.href}
                      className="block px-3 py-2 rounded-lg hover:bg-brand-cream text-sm text-foreground hover:text-brand-orange transition-colors"
                    >
                      {link.name}
                    </Link>
                  ))}
                </div>
              </div>
            </div>

            {/* Right side */}
            <div className="flex items-center gap-1.5">
              <Link href="/calculadora">
                <Button variant="ghost" size="icon" className="hidden md:flex text-muted-foreground hover:text-brand-orange h-10 w-10 rounded-xl">
                  <Calculator className="h-5 w-5" />
                </Button>
              </Link>
              <Link href="/presupuesto" className="relative">
                <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-brand-orange h-10 w-10 rounded-xl">
                  <ShoppingCart className="h-5 w-5" />
                  {totalItems > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 h-5 w-5 flex items-center justify-center text-[10px] font-bold bg-brand-orange text-white rounded-full">
                      {totalItems}
                    </span>
                  )}
                </Button>
              </Link>
              <Link href="/presupuesto" className="hidden md:block ml-1">
                <Button className="bg-brand-orange hover:bg-brand-orange-dark text-white rounded-full px-6 h-10 font-semibold shadow-md shadow-brand-orange/20">
                  Pedir Presupuesto
                </Button>
              </Link>

              {/* Mobile menu */}
              <Sheet>
                <SheetTrigger className="lg:hidden inline-flex items-center justify-center rounded-xl text-sm font-medium h-10 w-10 hover:bg-muted transition-colors">
                  <Menu className="h-5 w-5" />
                </SheetTrigger>
                <SheetContent side="right" className="w-80">
                  <div className="flex flex-col gap-1 mt-8">
                    <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-[0.15em] px-3 mb-2">
                      Productos
                    </p>
                    {productLinks.map((link) => (
                      <Link
                        key={link.href}
                        href={link.href}
                        className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-brand-cream text-sm"
                      >
                        <div className="w-8 h-8 rounded-lg bg-brand-orange/10 flex items-center justify-center">
                          <link.icon className="h-4 w-4 text-brand-orange" />
                        </div>
                        {link.name}
                      </Link>
                    ))}
                    <div className="border-t my-3" />
                    <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-[0.15em] px-3 mb-2">
                      Navegación
                    </p>
                    {navLinks.map((link) => (
                      <Link
                        key={link.href}
                        href={link.href}
                        className="px-3 py-2.5 rounded-xl hover:bg-brand-cream text-sm font-medium"
                      >
                        {link.name}
                      </Link>
                    ))}
                    <div className="border-t my-3" />
                    <Link href="/presupuesto">
                      <Button className="w-full bg-brand-orange hover:bg-brand-orange-dark text-white rounded-full font-semibold">
                        Pedir Presupuesto
                      </Button>
                    </Link>
                  </div>
                </SheetContent>
              </Sheet>
            </div>
          </div>
        </div>
      </nav>
    </>
  );
}
