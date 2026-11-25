import Image, { type StaticImageData } from "next/image";
import Link from "next/link";
import { ANIO_FUNDACION } from "@/lib/empresa";
import { DatosEstructurados } from "@/components/datos-estructurados";
import { migasJsonLd } from "@/lib/seo";
import { Isotipo } from "@/components/marca";

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
  foto,
}: {
  titulo: string;
  /**
   * Foto de fondo, atenuada. Sin ella va con las rayas y la «M».
   *
   * Las fotos de encabezado se recortan como banda (1920×800, docs/fotos.md):
   * a 1440×300 en la computadora solo se ve la franja del medio, y en el
   * teléfono queda detrás de la capa al 85 %. Una página para actuar o de
   * documentos (contacto, documentación, eventos) no gana nada con una foto.
   */
  foto?: string | StaticImageData;
  /** La ruta de la página: si está, emite las migas como datos estructurados. */
  ruta?: string;
  bajada?: string;
  /** Tramos intermedios entre Inicio y el título, si los hay. */
  migas?: { nombre: string; ruta: string }[];
}) {
  return (
    <section className={`relative overflow-hidden bg-oscuro-marca text-white ${foto ? "pb-16 pt-12 lg:pb-20 lg:pt-14" : "pb-[42px] pt-[38px]"}`}>
      {ruta && (
        <DatosEstructurados
          datos={migasJsonLd([
            { nombre: "Inicio", ruta: "/" },
            ...migas,
            { nombre: titulo, ruta },
          ])}
        />
      )}
      {foto ? (
        <>
          <Image src={foto} alt="" fill preload className="object-cover" sizes="100vw" placeholder={typeof foto === "string" ? "empty" : "blur"} />
          {/* En el teléfono el texto ocupa todo el ancho: oscuro parejo, para
              que las migas y la bajada se lean sobre cualquier parte de la foto. */}
          <div
            className="absolute inset-0 bg-oscuro-marca/85 sm:bg-transparent sm:bg-[linear-gradient(to_right,rgb(38_35_31_/_0.92),rgb(38_35_31_/_0.7)_55%,rgb(38_35_31_/_0.45))]"
            aria-hidden="true"
          />
        </>
      ) : (
        <div
          className="absolute inset-0 bg-[repeating-linear-gradient(-45deg,rgb(236_125_56_/_0.07)_0_12px,transparent_12px_24px)]"
          aria-hidden="true"
        />
      )}
      {/* La «M» del logo, grande y a un costado: la firma de la maderera en
          cada sección (notas del 9/11/2026). */}
      {!foto && (
        <Isotipo className="pointer-events-none absolute -right-4 top-1/2 hidden h-[150px] -translate-y-1/2 rotate-[-8deg] text-marca-naranja opacity-[0.16] md:block" />
      )}
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
