"use client";

import Image from "next/image";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  ArrowRight,
  Calculator,
  ClipboardList,
  Warehouse,
  MapPin,
  Star,
  Home,
  Layers,
  Grid3X3,
  Minus,
  Wrench,
  Footprints,
  Building,
  Umbrella,
  Truck,
  Shield,
  Users,
  Phone,
  ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { categories, testimonials, blogPosts } from "@/lib/products";

const iconMap: Record<string, React.ElementType> = {
  Home, Layers, Grid3X3, Minus, Wrench, Footprints, Building, Umbrella,
};

const fadeUp = {
  initial: { opacity: 0, y: 40 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: "-100px" },
  transition: { duration: 0.7, ease: [0.22, 1, 0.36, 1] as [number, number, number, number] },
};

const stagger = {
  initial: { opacity: 0, y: 24 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true },
};

export default function HomePage() {
  return (
    <>
      {/* HERO - Full impact, editorial style */}
      <section className="relative min-h-[92vh] flex items-end pb-16 overflow-hidden">
        <div className="absolute inset-0">
          <Image
            src="https://images.unsplash.com/photo-1520333789090-1afc82db536a?w=1920&q=80"
            alt="Madera de calidad"
            fill
            className="object-cover scale-105"
            priority
          />
          <div className="absolute inset-0 bg-gradient-to-t from-brand-gray via-brand-gray/60 to-brand-gray/20" />
          {/* Subtle orange glow */}
          <div className="absolute bottom-0 left-0 w-1/2 h-1/2 bg-gradient-to-tr from-brand-orange/20 to-transparent" />
        </div>
        <div className="container mx-auto px-4 relative z-10">
          <div className="max-w-4xl">
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.5 }}
              className="mb-6"
            >
              <div className="inline-flex items-center gap-2 bg-white/10 backdrop-blur-sm border border-white/10 rounded-full px-5 py-2">
                <div className="w-2 h-2 rounded-full bg-brand-orange animate-pulse" />
                <span className="text-white/90 text-sm font-medium tracking-wide">Desde 1981 en Mar del Plata</span>
              </div>
            </motion.div>
            <motion.h1
              className="text-5xl sm:text-6xl lg:text-8xl font-bold text-white mb-6 leading-[0.95] tracking-tight"
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, delay: 0.1 }}
            >
              Tu proyecto.
              <br />
              <span className="text-brand-orange">Nuestra madera.</span>
            </motion.h1>
            <motion.p
              className="text-lg sm:text-xl text-white/70 mb-10 max-w-xl leading-relaxed"
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, delay: 0.2 }}
            >
              Más de 40 años proveyendo productos de calidad para construcción,
              carpintería y diseño. Presupuestos sin cargo.
            </motion.p>
            <motion.div
              className="flex flex-wrap gap-4"
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, delay: 0.3 }}
            >
              <Link href="/presupuesto">
                <Button size="lg" className="bg-brand-orange hover:bg-brand-orange-dark text-white text-base h-14 px-8 rounded-full font-semibold shadow-lg shadow-brand-orange/25">
                  Pedir Presupuesto
                  <ArrowRight className="ml-2 h-5 w-5" />
                </Button>
              </Link>
              <Link href="/calculadora">
                <Button size="lg" variant="outline" className="border-white/20 text-white hover:bg-white/10 text-base h-14 px-8 rounded-full backdrop-blur-sm">
                  <Calculator className="mr-2 h-5 w-5" />
                  Calculá tus medidas
                </Button>
              </Link>
            </motion.div>
          </div>
          {/* Floating stats */}
          <motion.div
            className="absolute bottom-16 right-4 hidden xl:flex flex-col gap-4"
            initial={{ opacity: 0, x: 30 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.7, delay: 0.5 }}
          >
            {[
              { value: "43+", label: "Años" },
              { value: "2", label: "Sucursales" },
              { value: "200+", label: "Productos" },
            ].map((stat) => (
              <div key={stat.label} className="bg-white/10 backdrop-blur-md border border-white/10 rounded-2xl px-6 py-4 text-center min-w-[120px]">
                <p className="text-2xl font-bold text-brand-orange">{stat.value}</p>
                <p className="text-xs text-white/60 uppercase tracking-wider">{stat.label}</p>
              </div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* FEATURES STRIP - Horizontal ticker style */}
      <section className="bg-brand-gray text-white py-4 border-t border-white/5">
        <div className="container mx-auto px-4">
          <div className="flex items-center justify-between overflow-x-auto gap-8 no-scrollbar">
            {[
              { icon: Truck, text: "Entrega en obra" },
              { icon: Shield, text: "Calidad garantizada" },
              { icon: Users, text: "Asesoramiento experto" },
              { icon: Warehouse, text: "Stock permanente" },
              { icon: Phone, text: "(0223) 474-3328" },
            ].map((feat) => (
              <div key={feat.text} className="flex items-center gap-2 shrink-0">
                <feat.icon className="h-4 w-4 text-brand-orange" />
                <span className="text-sm text-white/70 whitespace-nowrap">{feat.text}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CATEGORIES - Bento grid layout */}
      <section className="py-24 stripe-pattern">
        <div className="container mx-auto px-4">
          <motion.div className="mb-16" {...fadeUp}>
            <div className="flex items-end justify-between flex-wrap gap-4">
              <div>
                <p className="text-brand-orange font-semibold text-sm uppercase tracking-wider mb-2">Catálogo</p>
                <h2 className="text-4xl sm:text-5xl font-bold tracking-tight">Nuestros Productos</h2>
              </div>
              <Link href="/catalogo">
                <Button variant="outline" className="rounded-full">
                  Ver todo el catálogo
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </Link>
            </div>
          </motion.div>

          {/* Bento-style grid - first two items are larger */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
            {categories.map((cat, i) => {
              const isLarge = i < 2;
              return (
                <motion.div
                  key={cat.id}
                  className={isLarge ? "col-span-2 row-span-2" : "col-span-1"}
                  {...stagger}
                  transition={{ delay: i * 0.06, duration: 0.5 }}
                >
                  <Link href={`/catalogo?cat=${cat.id}`} className="block h-full">
                    <div className={`group relative overflow-hidden rounded-2xl ${isLarge ? "h-72 sm:h-96" : "h-44 sm:h-52"} cursor-pointer`}>
                      <Image
                        src={cat.image}
                        alt={cat.name}
                        fill
                        className="object-cover group-hover:scale-110 transition-transform duration-700 ease-out"
                        sizes={isLarge ? "(max-width: 768px) 100vw, 50vw" : "(max-width: 768px) 50vw, 25vw"}
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent group-hover:from-brand-orange/80 transition-all duration-500" />
                      <div className="absolute bottom-0 left-0 right-0 p-4 sm:p-6">
                        <div className="flex items-end justify-between">
                          <div>
                            <h3 className={`text-white font-bold ${isLarge ? "text-xl sm:text-2xl" : "text-sm sm:text-base"} mb-1`}>
                              {cat.name}
                            </h3>
                            {isLarge && (
                              <p className="text-white/70 text-sm hidden sm:block">{cat.description}</p>
                            )}
                          </div>
                          <div className="bg-white/20 backdrop-blur-sm rounded-full p-2 group-hover:bg-brand-orange transition-colors">
                            <ChevronRight className="h-4 w-4 text-white" />
                          </div>
                        </div>
                      </div>
                      <div className="absolute top-3 right-3">
                        <Badge className="bg-white/20 backdrop-blur-sm border-0 text-white text-xs">
                          {cat.productCount} prod.
                        </Badge>
                      </div>
                    </div>
                  </Link>
                </motion.div>
              );
            })}
          </div>
        </div>
      </section>

      {/* TOOLS - Cards with icon accents */}
      <section className="py-24 bg-brand-gray relative overflow-hidden grain-overlay">
        <div className="container mx-auto px-4 relative z-10">
          <motion.div className="text-center mb-16" {...fadeUp}>
            <p className="text-brand-orange font-semibold text-sm uppercase tracking-wider mb-2">Herramientas Digitales</p>
            <h2 className="text-4xl sm:text-5xl font-bold text-white tracking-tight mb-4">
              Tu obra, simplificada
            </h2>
            <p className="text-white/50 max-w-2xl mx-auto text-lg">
              Planificá, calculá y presupuestá todo desde tu computadora o celular.
            </p>
          </motion.div>
          <div className="grid md:grid-cols-3 gap-6">
            {[
              {
                icon: Calculator,
                title: "Calculadora de Medidas",
                desc: "Techos, pisos, placas y decks. Obtené la cantidad exacta que necesitás para tu proyecto.",
                href: "/calculadora",
                accent: "from-brand-orange to-brand-orange-dark",
              },
              {
                icon: ClipboardList,
                title: "Presupuestador Online",
                desc: "Armá tu lista de materiales y recibí un presupuesto por email o WhatsApp sin cargo.",
                href: "/presupuesto",
                accent: "from-brand-green to-brand-green-light",
              },
              {
                icon: Warehouse,
                title: "Stock entre Sucursales",
                desc: "Consultá disponibilidad en tiempo real en Casa Central y Aserradero.",
                href: "/stock",
                accent: "from-brand-wood to-brand-wood-light",
              },
            ].map((tool, i) => (
              <motion.div key={tool.title} {...stagger} transition={{ delay: i * 0.12 }}>
                <Link href={tool.href}>
                  <Card className="h-full bg-white/5 border-white/10 hover:bg-white/10 hover:border-brand-orange/30 transition-all duration-300 group backdrop-blur-sm overflow-hidden">
                    <CardContent className="p-8 relative">
                      {/* Accent bar */}
                      <div className={`absolute top-0 left-0 right-0 h-1 bg-gradient-to-r ${tool.accent}`} />
                      <div className="w-14 h-14 rounded-2xl bg-gradient-to-br flex items-center justify-center mb-6 group-hover:scale-110 transition-transform border border-white/10"
                        style={{ background: `linear-gradient(135deg, oklch(0.68 0.19 48 / 0.2), oklch(0.68 0.19 48 / 0.05))` }}>
                        <tool.icon className="h-7 w-7 text-brand-orange" />
                      </div>
                      <h3 className="text-lg font-bold text-white mb-3">{tool.title}</h3>
                      <p className="text-sm text-white/50 mb-6 leading-relaxed">{tool.desc}</p>
                      <span className="inline-flex items-center text-brand-orange text-sm font-semibold group-hover:gap-2 transition-all">
                        Usar herramienta
                        <ArrowRight className="h-4 w-4 ml-1 group-hover:translate-x-1 transition-transform" />
                      </span>
                    </CardContent>
                  </Card>
                </Link>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ABOUT BANNER - Split layout */}
      <section className="py-24">
        <div className="container mx-auto px-4">
          <div className="grid lg:grid-cols-2 gap-16 items-center">
            <motion.div {...fadeUp}>
              <p className="text-brand-orange font-semibold text-sm uppercase tracking-wider mb-3">Nuestra Historia</p>
              <h2 className="text-4xl sm:text-5xl font-bold tracking-tight mb-6 leading-tight">
                Más de <span className="text-brand-orange">40 años</span> construyendo confianza
              </h2>
              <div className="wood-divider w-20 mb-6" />
              <p className="text-muted-foreground text-lg leading-relaxed mb-8">
                Desde 1981, Maderera Juan B. Justo es sinónimo de calidad en Mar del Plata.
                Con dos sucursales, marca propia Moldava y un equipo apasionado por la madera,
                acompañamos cada proyecto de principio a fin.
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-6 mb-8">
                {[
                  { value: "43+", label: "Años" },
                  { value: "2", label: "Sucursales" },
                  { value: "200+", label: "Productos" },
                  { value: "1000+", label: "Clientes" },
                ].map((stat) => (
                  <div key={stat.label} className="text-center sm:text-left">
                    <p className="text-3xl font-bold text-brand-orange">{stat.value}</p>
                    <p className="text-xs text-muted-foreground uppercase tracking-wider mt-1">{stat.label}</p>
                  </div>
                ))}
              </div>
              <Link href="/nosotros">
                <Button variant="outline" className="rounded-full">
                  Conocé nuestra historia
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </Link>
            </motion.div>
            <motion.div
              className="relative"
              initial={{ opacity: 0, x: 40 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.7 }}
            >
              <div className="relative h-[500px] rounded-3xl overflow-hidden">
                <Image
                  src="https://images.unsplash.com/photo-1504307651254-35680f356dfd?w=800&q=80"
                  alt="Nuestra historia"
                  fill
                  className="object-cover"
                />
              </div>
              {/* Floating Moldava card */}
              <div className="absolute -bottom-6 -left-6 bg-white rounded-2xl shadow-2xl p-6 max-w-[240px] border">
                <p className="font-bold text-lg mb-1">Moldava</p>
                <p className="text-sm text-muted-foreground">Nuestra marca propia de molduras con distribución nacional.</p>
              </div>
            </motion.div>
          </div>
        </div>
      </section>

      {/* TESTIMONIALS - Magazine style */}
      <section className="py-24 bg-brand-cream">
        <div className="container mx-auto px-4">
          <motion.div className="mb-16" {...fadeUp}>
            <p className="text-brand-orange font-semibold text-sm uppercase tracking-wider mb-2">Testimonios</p>
            <h2 className="text-4xl sm:text-5xl font-bold tracking-tight">
              Lo que dicen nuestros clientes
            </h2>
          </motion.div>
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
            {testimonials.map((t, i) => (
              <motion.div key={t.name} {...stagger} transition={{ delay: i * 0.1 }}>
                <Card className="h-full bg-white border-0 shadow-sm hover:shadow-xl transition-shadow duration-300">
                  <CardContent className="p-6">
                    <div className="flex gap-0.5 mb-5">
                      {Array.from({ length: 5 }).map((_, j) => (
                        <Star key={j} className="h-4 w-4 fill-brand-orange text-brand-orange" />
                      ))}
                    </div>
                    <p className="text-sm text-foreground/80 mb-6 leading-relaxed">
                      &ldquo;{t.text}&rdquo;
                    </p>
                    <div className="flex items-center gap-3 pt-4 border-t border-border/50">
                      <div className="w-11 h-11 rounded-full bg-brand-gray flex items-center justify-center">
                        <span className="text-sm font-bold text-white">{t.avatar}</span>
                      </div>
                      <div>
                        <p className="text-sm font-semibold">{t.name}</p>
                        <p className="text-xs text-muted-foreground">{t.role}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* BRANCHES - Card style with warm tones */}
      <section className="py-24">
        <div className="container mx-auto px-4">
          <motion.div className="text-center mb-16" {...fadeUp}>
            <p className="text-brand-orange font-semibold text-sm uppercase tracking-wider mb-2">Ubicaciones</p>
            <h2 className="text-4xl sm:text-5xl font-bold tracking-tight mb-4">Nuestras Sucursales</h2>
            <p className="text-muted-foreground text-lg max-w-xl mx-auto">
              Dos ubicaciones estratégicas en Mar del Plata.
            </p>
          </motion.div>
          <div className="grid md:grid-cols-2 gap-8 max-w-5xl mx-auto">
            {[
              {
                name: "Casa Central",
                address: "Av. Juan B. Justo 4153",
                phone: "(0223) 474-3328",
                whatsapp: "2235903118",
                services: ["Corte de placas a medida", "Exhibición de muebles", "Amplio stock de molduras", "Fenólicos y puntales"],
              },
              {
                name: "Aserradero",
                address: "Canosa N°61",
                phone: "(0223) 483-0535",
                whatsapp: "2235060817",
                services: ["Planta de fabricación", "Stock techos y escaleras", "Pisos deck y machimbres", "Ferretería y lacas"],
              },
            ].map((branch, i) => (
              <motion.div key={branch.name} {...stagger} transition={{ delay: i * 0.15 }}>
                <Card className="overflow-hidden group hover:shadow-2xl transition-all duration-300 border-0 shadow-lg">
                  <div className="h-56 relative overflow-hidden">
                    <Image
                      src="https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=600&q=80"
                      alt={branch.name}
                      fill
                      className="object-cover group-hover:scale-105 transition-transform duration-700"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-brand-gray to-transparent" />
                    <div className="absolute bottom-5 left-5">
                      <h3 className="text-white text-2xl font-bold">{branch.name}</h3>
                      <p className="text-white/70 text-sm flex items-center gap-1 mt-1">
                        <MapPin className="h-3 w-3" />
                        {branch.address}, Mar del Plata
                      </p>
                    </div>
                  </div>
                  <CardContent className="p-6">
                    <ul className="space-y-2 mb-5">
                      {branch.services.map((s) => (
                        <li key={s} className="text-sm text-muted-foreground flex items-center gap-2">
                          <div className="w-1.5 h-1.5 rounded-full bg-brand-orange shrink-0" />
                          {s}
                        </li>
                      ))}
                    </ul>
                    <div className="flex gap-2">
                      <a href={`https://wa.me/549${branch.whatsapp}`} target="_blank" rel="noopener noreferrer" className="flex-1">
                        <Button className="w-full bg-brand-orange hover:bg-brand-orange-dark text-white rounded-full">
                          WhatsApp
                        </Button>
                      </a>
                      <a href={`tel:${branch.phone.replace(/[^0-9]/g, "")}`} className="flex-1">
                        <Button variant="outline" className="w-full rounded-full">
                          Llamar
                        </Button>
                      </a>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* BLOG PREVIEW */}
      <section className="py-24 bg-brand-cream">
        <div className="container mx-auto px-4">
          <motion.div className="flex items-end justify-between flex-wrap gap-4 mb-16" {...fadeUp}>
            <div>
              <p className="text-brand-orange font-semibold text-sm uppercase tracking-wider mb-2">Blog</p>
              <h2 className="text-4xl sm:text-5xl font-bold tracking-tight">Novedades & Tips</h2>
            </div>
            <Link href="/blog">
              <Button variant="outline" className="rounded-full">
                Ver todos
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </Link>
          </motion.div>
          <div className="grid md:grid-cols-3 gap-6">
            {blogPosts.slice(0, 3).map((post, i) => (
              <motion.div key={post.id} {...stagger} transition={{ delay: i * 0.1 }}>
                <Link href="/blog">
                  <Card className="group overflow-hidden hover:shadow-xl transition-all duration-300 h-full border-0 shadow-sm bg-white">
                    <div className="relative h-52 overflow-hidden">
                      <Image
                        src={post.image}
                        alt={post.title}
                        fill
                        className="object-cover group-hover:scale-105 transition-transform duration-700"
                      />
                      <div className="absolute top-3 left-3">
                        <Badge className="bg-brand-gray/80 backdrop-blur-sm border-0 text-white text-xs">
                          {post.category}
                        </Badge>
                      </div>
                    </div>
                    <CardContent className="p-5">
                      <div className="flex items-center gap-2 text-xs text-muted-foreground mb-3">
                        <span>{post.date}</span>
                        <span className="w-1 h-1 rounded-full bg-muted-foreground" />
                        <span>{post.readTime} lectura</span>
                      </div>
                      <h3 className="font-bold mb-2 group-hover:text-brand-orange transition-colors line-clamp-2 leading-snug">
                        {post.title}
                      </h3>
                      <p className="text-sm text-muted-foreground line-clamp-2">
                        {post.excerpt}
                      </p>
                    </CardContent>
                  </Card>
                </Link>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* FINAL CTA - Bold, full-width */}
      <section className="relative py-28 overflow-hidden">
        <div className="absolute inset-0 bg-brand-orange" />
        {/* Geometric accent */}
        <div className="absolute top-0 right-0 w-1/3 h-full bg-brand-orange-dark opacity-50 skew-x-[-12deg] translate-x-20" />
        <div className="container mx-auto px-4 text-center relative z-10">
          <motion.div {...fadeUp}>
            <h2 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-white mb-6 tracking-tight">
              ¿Tenés un proyecto<br className="hidden sm:block" /> en mente?
            </h2>
            <p className="text-white/80 text-lg mb-10 max-w-xl mx-auto">
              Contactanos y recibí asesoramiento gratuito. Presupuestos sin cargo
              para tu obra o proyecto.
            </p>
            <div className="flex flex-wrap justify-center gap-4">
              <Link href="/presupuesto">
                <Button size="lg" className="bg-white text-brand-orange hover:bg-white/90 text-base h-14 px-10 rounded-full font-semibold shadow-lg">
                  Pedir Presupuesto Gratis
                  <ArrowRight className="ml-2 h-5 w-5" />
                </Button>
              </Link>
              <Link href="/contacto">
                <Button size="lg" variant="outline" className="border-white/30 text-white hover:bg-white/10 text-base h-14 px-10 rounded-full">
                  Contactanos
                </Button>
              </Link>
            </div>
          </motion.div>
        </div>
      </section>
    </>
  );
}
