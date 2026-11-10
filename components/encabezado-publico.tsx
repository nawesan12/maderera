import Image from "next/image";
import Link from "next/link";
import { ANIO_FUNDACION } from "@/lib/empresa";
import { DatosEstructurados } from "@/components/datos-estructurados";
import { migasJsonLd } from "@/lib/seo";

/**
 * Encabezado de las páginas de contenido.
 *
 * Las siete secciones públicas tenían cada una su propia banda oscura, con
 * alturas y tamaños distintos: 12, 14 y 24 de padding, títulos de 3xl, 4xl y
 * 5xl. Se veía como siete plantillas y no como un sitio.
 *
 * Las migas van acá y no en cada página porque son siempre las mismas —Inicio
 * y dónde estás— y porque una miga que existe en el marcado pero no en la
 * pantalla no le sirve a nadie más que al buscador.
 *
 * Con `ruta`, las mismas migas salen además como `BreadcrumbList`: lo que se
 * ve y lo que lee Google, de una sola fuente.
 */
export function EncabezadoPublico({
  titulo,
  bajada,
  migas = [],
  ruta,
}: {
  titulo: string;
  /** La ruta de la página: si está, emite las migas como datos estructurados. */
  ruta?: string;
  bajada?: string;
  /** Tramos intermedios entre Inicio y el título, si los hay. */
  migas?: { nombre: string; ruta: string }[];
}) {
  return (
    <section className="relative overflow-hidden bg-oscuro-marca pb-[42px] pt-[38px] text-white">
      {ruta && (
        <DatosEstructurados
          datos={migasJsonLd([
            { nombre: "Inicio", ruta: "/" },
            ...migas,
            { nombre: titulo, ruta },
          ])}
        />
      )}
      <div
        className="absolute inset-0 bg-[repeating-linear-gradient(-45deg,rgb(240_115_22_/_0.07)_0_12px,transparent_12px_24px)]"
        aria-hidden="true"
      />
      {/* La «M» del logo, grande y a un costado: la firma de la maderera en
          cada sección (notas del 9/11/2026). */}
      <Image
        src="/cropped-icon-180x180.png"
        alt=""
        width={180}
        height={180}
        className="pointer-events-none absolute -right-6 top-1/2 hidden -translate-y-1/2 rotate-[-8deg] rounded-[40px] opacity-[0.13] md:block"
        aria-hidden="true"
      />
      <div className="contenedor relative">
        <nav
          aria-label="Dónde estás"
          className="flex flex-wrap items-center gap-2 text-[13.5px] text-white/60"
        >
          <Link href="/" className="transition-colors hover:text-white">
            Inicio
          </Link>
          {migas.map((m) => (
            <span key={m.ruta} className="flex items-center gap-2">
              <span aria-hidden="true">&rsaquo;</span>
              <Link href={m.ruta} className="transition-colors hover:text-white">
                {m.nombre}
              </Link>
            </span>
          ))}
          <span aria-hidden="true">&rsaquo;</span>
          <span className="text-white">{titulo}</span>
        </nav>

        <p className="mt-4 text-[12px] font-semibold uppercase tracking-[0.32em] text-brand-orange-light">
          Juan B. Justo · Desde {ANIO_FUNDACION}
        </p>
        <h1 className="mt-1.5 text-[40px] font-extrabold leading-[1.08] tracking-[-0.035em]">
          {titulo}
        </h1>
        {bajada && (
          <p className="mt-2 max-w-[560px] text-[17px] text-white/70">
            {bajada}
          </p>
        )}
      </div>
    </section>
  );
}
