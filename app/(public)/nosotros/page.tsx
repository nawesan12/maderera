"use client";

import Image from "next/image";
import Link from "next/link";
import { motion } from "framer-motion";
import { Award, Users, Truck, Shield, Factory, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { AnimatedCounter } from "@/components/animated-counter";

const timeline = [
  { year: "1981", title: "Fundación", desc: "Nace Maderera Juan B. Justo como una empresa familiar dedicada a la venta de maderas en bruto en Mar del Plata." },
  { year: "1990", title: "Expansión a Techos", desc: "Incorporamos la elaboración de techos, machimbres y molduras. Ampliamos nuestro aserradero con tecnología moderna." },
  { year: "2000", title: "Placas y Corte", desc: "Sumamos la línea de placas y tableros con servicio de corte a medida. Instalamos maquinaria de precisión." },
  { year: "2005", title: "Marca Moldava", desc: "Creamos Moldava, nuestra marca propia de molduras y listonería en Pino Finger Joint, con distribución nacional." },
  { year: "2010", title: "Nueva Sucursal", desc: "Apertura de la sucursal en Av. Constitución. Ampliamos la flota de entrega con vehículos propios." },
  { year: "2015", title: "Ferretería y más", desc: "Incorporamos la sección de ferretería con herrajes, accesorios, lacas y todo para el acabado de tu proyecto." },
  { year: "2020", title: "Construcción en Seco", desc: "Sumamos la línea completa de construcción en seco: placas de yeso, perfiles y aislantes." },
  { year: "2026", title: "Transformación Digital", desc: "Lanzamos nuestra nueva plataforma web con calculadoras, presupuestador online y stock en tiempo real." },
];

export default function NosotrosPage() {
  return (
    <div className="min-h-screen">
      {/* Hero */}
      <section className="relative py-24 overflow-hidden">
        <div className="absolute inset-0">
          <Image
            src="https://images.unsplash.com/photo-1520333789090-1afc82db536a?w=1920&q=80"
            alt="Maderera Juan B. Justo"
            fill
            className="object-cover"
          />
          <div className="absolute inset-0 bg-brand-gray/85" />
        </div>
        <div className="container mx-auto px-4 relative z-10 text-center text-white">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
            <Badge className="bg-brand-orange/20 text-brand-orange border-brand-orange/30 mb-6 text-sm">
              Nuestra Historia
            </Badge>
            <h1 className="text-4xl sm:text-5xl font-bold mb-4">
              Más de 40 años construyendo{" "}
              <span className="text-brand-orange">confianza</span>
            </h1>
            <p className="text-lg text-white/70 max-w-2xl mx-auto">
              Desde 1981, somos una empresa familiar que creció junto a Mar del Plata,
              proveyendo los mejores productos de la industria maderera.
            </p>
          </motion.div>
        </div>
      </section>

      {/* Values */}
      <section className="py-16">
        <div className="container mx-auto px-4">
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
            {[
              { icon: Award, title: "Calidad", desc: "Seleccionamos los mejores materiales para garantizar resultados duraderos." },
              { icon: Users, title: "Servicio", desc: "Asesoramiento personalizado con un equipo que conoce cada producto." },
              { icon: Truck, title: "Logística", desc: "Entrega en obra con flota propia en Mar del Plata y alrededores." },
              { icon: Shield, title: "Confianza", desc: "43 años respaldando a profesionales y particulares con seriedad." },
            ].map((value, i) => (
              <motion.div
                key={value.title}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.1 }}
              >
                <Card className="h-full text-center hover:shadow-lg transition-shadow">
                  <CardContent className="p-6">
                    <div className="w-14 h-14 bg-brand-orange/10 rounded-2xl flex items-center justify-center mx-auto mb-4">
                      <value.icon className="h-7 w-7 text-brand-orange" />
                    </div>
                    <h3 className="font-semibold mb-2">{value.title}</h3>
                    <p className="text-sm text-muted-foreground">{value.desc}</p>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Timeline */}
      <section className="py-16 bg-muted/50">
        <div className="container mx-auto px-4">
          <h2 className="text-3xl font-bold text-center mb-12">Nuestra Trayectoria</h2>
          <div className="max-w-3xl mx-auto">
            {timeline.map((item, i) => (
              <motion.div
                key={item.year}
                className="flex gap-6 pb-10 last:pb-0"
                initial={{ opacity: 0, x: -20 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.08 }}
              >
                <div className="flex flex-col items-center">
                  <div className="w-12 h-12 bg-brand-orange rounded-full flex items-center justify-center shrink-0">
                    <span className="text-white font-bold text-xs">{item.year}</span>
                  </div>
                  {i < timeline.length - 1 && <div className="w-0.5 flex-1 bg-brand-orange/20 mt-2" />}
                </div>
                <div className="pb-2">
                  <h3 className="font-semibold text-lg">{item.title}</h3>
                  <p className="text-sm text-muted-foreground">{item.desc}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Moldava */}
      <section className="py-16">
        <div className="container mx-auto px-4">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <motion.div
              initial={{ opacity: 0, x: -30 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
            >
              <Badge className="bg-brand-green/10 text-brand-green border-brand-green/30 mb-4">
                Marca Propia
              </Badge>
              <h2 className="text-3xl font-bold mb-4">Moldava</h2>
              <p className="text-muted-foreground mb-6">
                Moldava es nuestra marca propia de molduras y listonería en Pino Finger Joint.
                Con producción en nuestro aserradero de Mar del Plata, distribuimos a todo el país
                con los más altos estándares de calidad.
              </p>
              <ul className="space-y-3 mb-6">
                {[
                  "Producción propia con control de calidad",
                  "Pino Finger Joint de primera selección",
                  "Distribución nacional",
                  "Variedad de perfiles: zócalos, marcos, cornisas y más",
                  "Listos para pintar o lacar",
                ].map((item) => (
                  <li key={item} className="flex items-center gap-2 text-sm">
                    <div className="w-2 h-2 rounded-full bg-brand-green shrink-0" />
                    {item}
                  </li>
                ))}
              </ul>
              <Link href="/catalogo?cat=molduras">
                <Button className="bg-brand-orange hover:bg-brand-orange-dark text-white">
                  Ver catálogo de molduras
                </Button>
              </Link>
            </motion.div>
            <motion.div
              className="relative h-80 lg:h-96 rounded-2xl overflow-hidden"
              initial={{ opacity: 0, x: 30 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
            >
              <Image
                src="https://images.unsplash.com/photo-1504148455328-c376907d081c?w=800&q=80"
                alt="Molduras Moldava"
                fill
                className="object-cover"
              />
            </motion.div>
          </div>
        </div>
      </section>

      {/* Stats */}
      <section className="py-16 bg-brand-orange text-white">
        <div className="container mx-auto px-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
            {[
              { target: 43, suffix: "+", label: "Años de experiencia" },
              { target: 2, suffix: "", label: "Sucursales en Mar del Plata" },
              { target: 200, suffix: "+", label: "Productos en catálogo" },
              { target: 1000, suffix: "+", label: "Clientes satisfechos" },
            ].map((stat) => (
              <div key={stat.label}>
                <p className="text-4xl font-bold">
                  <AnimatedCounter target={stat.target} suffix={stat.suffix} />
                </p>
                <p className="text-sm text-white/70 mt-1">{stat.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
