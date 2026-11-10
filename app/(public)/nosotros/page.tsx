import type { Metadata } from "next";
import { readdirSync } from "node:fs";
import path from "node:path";
import Image from "next/image";
import Link from "next/link";
import { ArrowRight, MapPin, MessageCircle, Scissors, Truck, Users } from "lucide-react";
import { EncabezadoPublico } from "@/components/encabezado-publico";
import { ANIO_FUNDACION, numerosDeLaEmpresa } from "@/lib/dal/catalog";
import { listarSucursalesPublicas } from "@/lib/dal/envios";
import { DatosEstructurados } from "@/components/datos-estructurados";
import { migasJsonLd, metadatosDePagina } from "@/lib/seo";
import { ALCANCE_MOLDAVA, masDeAnios } from "@/lib/empresa";

/**
 * Quiénes somos (notas del 9/11/2026: «hacer más enriquecida la página»).
 *
 * **Solo lo verificable.** El brief volvió con la trayectoria en blanco, así
 * que no se cuenta una historia que no nos dieron: los números salen de la
 * base, las sucursales de `lib/sucursales.ts` y la galería de las fotos que
 * haya en `public/nosotros/`. Sin fotos, la galería no aparece.
 */

export const metadata: Metadata = {
  ...metadatosDePagina({
    titulo: "Quiénes somos — maderera familiar desde 1981",
    descripcion: `Empresa familiar fundada en ${ANIO_FUNDACION} en Mar del Plata. ${masDeAnios()} proveyendo madera. Casa Central y Aserradero, corte a medida y marca propia Moldava.`,
    ruta: "/nosotros",
  }),
  keywords: ["maderera juan b justo historia", "moldava molduras", "empresa madera mar del plata", "maderera desde 1981"],
};

/** Las fotos reales de la maderera: se dejan en public/nosotros y aparecen. */
function fotosDeLaGaleria(): string[] {
  try {
    return readdirSync(path.join(process.cwd(), "public", "nosotros"))
      .filter((f) => /\.(jpe?g|png|webp|avif)$/i.test(f))
      .sort()
      .map((f) => `/nosotros/${f}`);
  } catch {
    return [];
  }
}

const SERVICIOS = [
  { icono: Scissors, titulo: "Corte a medida", detalle: "Seccionadora en el aserradero.", href: "/corte" },
  { icono: Truck, titulo: "Entregas", detalle: "En Mar del Plata y zona.", href: "/sucursales" },
  { icono: Users, titulo: "Cuenta profesional", detalle: "Precios de gremio y cuenta corriente.", href: "/profesionales" },
];

export default async function NosotrosPage() {
  const [numeros, sucursales] = await Promise.all([numerosDeLaEmpresa(), listarSucursalesPublicas()]);
  const fotos = fotosDeLaGaleria();

  const cifras = [
    { valor: numeros.anios, etiqueta: "años" },
    { valor: numeros.sucursales, etiqueta: "sucursales" },
    { valor: numeros.medidas, etiqueta: "medidas" },
    { valor: numeros.rubros, etiqueta: "rubros" },
  ];

  return (
    <div className="min-h-screen bg-sitio-fondo">
      <DatosEstructurados
        datos={migasJsonLd([
          { nombre: "Inicio", ruta: "/" },
          { nombre: "Quiénes somos", ruta: "/nosotros" },
        ])}
      />

      <EncabezadoPublico titulo="Nosotros" bajada={`Empresa familiar de Mar del Plata desde ${ANIO_FUNDACION}.`} />

      <section className="border-b border-linea bg-card">
        <dl className="contenedor grid grid-cols-2 divide-linea py-10 md:grid-cols-4 md:divide-x">
          {cifras.map((c) => (
            <div key={c.etiqueta} className="flex flex-col-reverse items-center py-3 text-center">
              <dt className="mt-1 text-base uppercase tracking-[0.18em] text-texto-3">{c.etiqueta}</dt>
              <dd className="tabular text-[56px] font-extrabold leading-none tracking-[-0.04em] text-foreground">{c.valor}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="contenedor py-16">
        <h2 className="text-[32px] font-bold tracking-[-0.03em]">Dónde estamos</h2>
        <div className="mt-7 grid gap-5 lg:grid-cols-2">
          {sucursales.map((s) => (
            <article key={s.slug} className="flex flex-col gap-5 rounded-2xl border border-linea bg-card p-5 sm:flex-row">
              {s.foto && (
                <Image
                  src={s.foto.ruta}
                  alt={s.nombre}
                  width={s.foto.ancho}
                  height={s.foto.alto}
                  className="h-40 w-full shrink-0 rounded-xl object-cover sm:h-auto sm:w-44"
                />
              )}
              <div className="flex min-w-0 flex-1 flex-col">
                <h3 className="text-[24px] font-bold tracking-[-0.02em]">{s.nombre}</h3>
                <p className="mt-1 text-base text-texto-2">{s.direccion}</p>
                {s.horario && <p className="text-base text-texto-2">{s.horario}</p>}
                {s.destacados && (
                  <ul className="mt-3 flex flex-wrap gap-1.5">
                    {s.destacados.split("\n").map((d) => (
                      <li key={d} className="rounded-full bg-naranja-claro px-3 py-1 text-sm font-medium text-acento-sobre-claro">
                        {d}
                      </li>
                    ))}
                  </ul>
                )}
                <div className="mt-auto flex flex-wrap gap-2 pt-4">
                  {s.mapUrl && (
                    <a
                      href={s.mapUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex h-11 items-center gap-2 rounded-[10px] border border-linea px-4 font-semibold transition-colors hover:bg-sitio-alt"
                    >
                      <MapPin className="h-4 w-4" />
                      Cómo llegar
                    </a>
                  )}
                  {s.whatsapp && (
                    <a
                      href={`https://wa.me/${s.whatsapp}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex h-11 items-center gap-2 rounded-[10px] bg-verde-whatsapp px-4 font-semibold text-white"
                    >
                      <MessageCircle className="h-4 w-4" />
                      WhatsApp
                    </a>
                  )}
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="bg-sitio-alt py-16">
        <div className="contenedor">
          <h2 className="text-[32px] font-bold tracking-[-0.03em]">Lo que hacemos</h2>
          <div className="mt-7 grid gap-4 md:grid-cols-3">
            {SERVICIOS.map((s) => (
              <Link
                key={s.titulo}
                href={s.href}
                className="group rounded-2xl border border-linea bg-card p-6 transition-colors hover:border-accion/50"
              >
                <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-naranja-claro text-acento-texto">
                  <s.icono className="h-6 w-6" />
                </span>
                <span className="mt-4 flex items-center gap-2 text-[22px] font-bold tracking-[-0.02em]">
                  {s.titulo}
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                </span>
                <span className="mt-1 block text-base text-texto-2">{s.detalle}</span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-oscuro-marca py-16 text-white">
        <div className="contenedor grid items-center gap-10 lg:grid-cols-[1.2fr_1fr]">
          <div>
            <span className="rounded-full bg-accion px-3 py-1 text-[12px] font-bold uppercase tracking-[0.08em]">
              Línea propia
            </span>
            <h2 className="mt-4 text-[48px] font-extrabold leading-none tracking-[-0.035em]">Moldava</h2>
            <p className="mt-4 max-w-[520px] text-lg text-white/75">
              Molduras y listonería en pino finger joint, fabricadas en nuestra planta. Piezas de 3,05 m, sin nudos.
              Venta minorista y mayorista en {ALCANCE_MOLDAVA}.
            </p>
            <Link
              href="/moldava"
              className="mt-6 inline-flex h-12 items-center gap-2 rounded-[10px] bg-accion px-5 font-semibold transition-colors hover:bg-accion-hover"
            >
              Conocer Moldava
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
          <div className="relative h-72 overflow-hidden rounded-2xl lg:h-80">
            <Image
              src="/fotos/photo-1764283824453-02cd00e49143.jpg"
              alt="Molduras Moldava"
              fill
              sizes="(min-width: 1024px) 40vw, 100vw"
              className="object-cover"
            />
          </div>
        </div>
      </section>

      {fotos.length > 0 && (
        <section className="contenedor py-16">
          <div className="grid auto-rows-[200px] grid-cols-2 gap-3 md:grid-cols-4">
            {fotos.map((f, i) => (
              <div
                key={f}
                className={`relative overflow-hidden rounded-xl ${i % 5 === 0 ? "col-span-2 row-span-2" : ""}`}
              >
                <Image src={f} alt="" fill sizes="(min-width: 768px) 50vw, 100vw" className="object-cover" />
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
