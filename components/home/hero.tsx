"use client";

import Image from "next/image";
import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowRight, Calculator } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AnimatedCounter } from "@/components/animated-counter";

/**
 * Portada.
 *
 * Los números que acompañan son los reales del negocio, así que se los pasa la
 * página en vez de tenerlos escritos acá: si mañana hay trescientos productos,
 * el hero lo dice solo.
 */
export function Hero({
  productos,
  sucursales,
  anios,
}: {
  productos: number;
  sucursales: number;
  anios: number;
}) {
  const stats = [
    { target: anios, suffix: "+", label: "Años" },
    { target: sucursales, suffix: "", label: "Sucursales" },
    { target: productos, suffix: "+", label: "Productos" },
  ];

  return (
    <section className="relative flex min-h-[92vh] items-end overflow-hidden pb-16">
      <div className="absolute inset-0">
        <Image
          src="https://images.unsplash.com/photo-1520333789090-1afc82db536a?w=1920&q=80"
          alt=""
          fill
          className="scale-105 object-cover"
          priority
        />
        <div className="absolute inset-0 bg-gradient-to-t from-brand-gray via-brand-gray/60 to-brand-gray/20" />
        <div className="absolute bottom-0 left-0 h-1/2 w-1/2 bg-gradient-to-tr from-brand-orange/20 to-transparent" />
      </div>

      <div className="container relative z-10 mx-auto px-4">
        <div className="max-w-4xl">
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.5 }}
            className="mb-6"
          >
            <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/10 px-5 py-2 backdrop-blur-sm">
              <div className="h-2 w-2 animate-pulse rounded-full bg-brand-orange" />
              <span className="text-sm font-medium tracking-wide text-white/90">
                Desde 1981 en Mar del Plata
              </span>
            </div>
          </motion.div>

          <motion.h1
            className="mb-6 text-5xl font-bold leading-[0.95] tracking-tight text-white sm:text-6xl lg:text-8xl"
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.1 }}
          >
            Tu proyecto.
            <br />
            <span className="text-brand-orange">Nuestra madera.</span>
          </motion.h1>

          <motion.p
            className="mb-10 max-w-xl text-lg leading-relaxed text-white/70 sm:text-xl"
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
            <Link href="/catalogo">
              <Button
                size="lg"
                className="h-14 rounded-full bg-brand-orange px-8 text-base font-semibold text-white shadow-lg shadow-brand-orange/25 hover:bg-brand-orange-dark"
              >
                Ver el catálogo
                <ArrowRight className="ml-2 h-5 w-5" />
              </Button>
            </Link>
            <Link href="/calculadora">
              <Button
                size="lg"
                className="h-14 rounded-full border-2 border-white/30 bg-white/10 px-8 text-base !text-white backdrop-blur-sm hover:bg-white/20"
              >
                <Calculator className="mr-2 h-5 w-5" />
                Calculá tus medidas
              </Button>
            </Link>
          </motion.div>
        </div>

        <motion.div
          className="absolute bottom-16 right-4 hidden flex-col gap-4 xl:flex"
          initial={{ opacity: 0, x: 30 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.7, delay: 0.5 }}
        >
          {stats.map((stat) => (
            <div
              key={stat.label}
              className="min-w-[120px] rounded-2xl border border-white/10 bg-white/10 px-6 py-4 text-center backdrop-blur-md"
            >
              <p className="text-2xl font-bold text-brand-orange">
                <AnimatedCounter target={stat.target} suffix={stat.suffix} />
              </p>
              <p className="text-xs uppercase tracking-wider text-white/60">
                {stat.label}
              </p>
            </div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
