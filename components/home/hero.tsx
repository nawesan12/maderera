"use client";

import Image from "next/image";
import Link from "next/link";
import { motion } from "framer-motion";
import { AnimatedCounter } from "@/components/animated-counter";

/**
 * Portada.
 *
 * Los números que acompañan son los reales del negocio, así que se los pasa la
 * página en vez de tenerlos escritos acá: si mañana hay trescientos productos,
 * el hero lo dice solo.
 *
 * La foto dejó de ser el fondo de todo para ocupar una banda a la derecha. A
 * sangre completa había que taparla con un degradado para que el título se
 * leyera, y eso dejaba la foto oscurecida y el texto igual peleando contra lo
 * que hubiera detrás. Partida en dos, cada mitad hace una sola cosa.
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
  const contadores = [
    { target: anios, suffix: "+", label: "Años" },
    { target: sucursales, suffix: "", label: "Sucursales" },
    { target: productos, suffix: "+", label: "Productos" },
  ];

  return (
    <section className="relative overflow-hidden bg-oscuro-marca text-white">
      <div
        className="absolute inset-0 bg-[repeating-linear-gradient(-45deg,rgb(240_115_22_/_0.05)_0_12px,transparent_12px_24px)]"
        aria-hidden="true"
      />

      <div className="absolute inset-y-0 right-0 hidden w-[46%] lg:block">
        <Image
          src="https://plus.unsplash.com/premium_photo-1663133630972-d9b620dfea27?q=80&w=1600&auto=format&fit=crop"
          alt="Corte de madera con sierra en el aserradero"
          fill
          className="object-cover object-center"
          priority
          sizes="46vw"
        />
        {/* El degradado solo funde el borde contra el fondo del texto. Antes
            cubría el 38% del panel y se comía justo la sierra, que es lo que
            hay que ver. */}
        <div
          className="absolute inset-0 bg-[linear-gradient(to_right,var(--color-oscuro-marca),rgb(38_35_31_/_0.45)_14%,transparent_34%)]"
          aria-hidden="true"
        />
      </div>

      <div className="contenedor relative pb-[76px] pt-[88px]">
        <div className="max-w-[560px]">
          <motion.span
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.5 }}
            className="inline-flex items-center gap-2.5 rounded-full border border-white/15 bg-white/10 px-3.5 py-1.5 text-[13.5px] text-white/85"
          >
            <span
              className="h-[7px] w-[7px] rounded-full bg-brand-orange motion-safe:animate-pulse"
              aria-hidden="true"
            />
            Desde 1981 en Mar del Plata
          </motion.span>

          <motion.h1
            className="mt-[22px] text-[40px] font-extrabold leading-[1.02] tracking-[-0.035em] text-balance sm:text-5xl lg:text-[60px]"
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.1 }}
          >
            Tu proyecto.
            <br />
            <span className="text-brand-orange-light">Nuestra madera.</span>
          </motion.h1>

          <motion.p
            className="mt-5 max-w-[440px] text-lg leading-relaxed text-white/75"
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.2 }}
          >
            Maderas, placas y ferretería para obra y carpintería, con corte a
            medida y entrega en toda la ciudad.
          </motion.p>

          <motion.div
            className="mt-[30px] flex flex-wrap gap-3"
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.3 }}
          >
            <Link
              href="/catalogo"
              className="flex h-[52px] items-center rounded-[10px] bg-brand-orange px-6 text-base font-semibold text-white transition-colors hover:bg-accion-hover"
            >
              Ver el catálogo
            </Link>
            <Link
              href="/presupuesto"
              className="flex h-[52px] items-center rounded-[10px] border border-white/25 px-6 text-base font-semibold text-white transition-colors hover:bg-white/10"
            >
              Pedir un corte a medida
            </Link>
          </motion.div>

          <motion.dl
            className="mt-11 flex gap-10"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.45 }}
          >
            {contadores.map((c) => (
              <div key={c.label}>
                <dd className="tabular text-[34px] font-bold leading-none tracking-[-0.03em]">
                  <AnimatedCounter target={c.target} suffix={c.suffix} />
                </dd>
                <dt className="mt-1 text-[13px] uppercase tracking-[0.07em] text-white/60">
                  {c.label}
                </dt>
              </div>
            ))}
          </motion.dl>
        </div>
      </div>
    </section>
  );
}
