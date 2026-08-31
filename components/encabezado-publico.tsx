import Link from "next/link";

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
 */
export function EncabezadoPublico({
  titulo,
  bajada,
  migas = [],
}: {
  titulo: string;
  bajada?: string;
  /** Tramos intermedios entre Inicio y el título, si los hay. */
  migas?: { nombre: string; ruta: string }[];
}) {
  return (
    <section className="relative overflow-hidden bg-oscuro-marca pb-[42px] pt-[38px] text-white">
      <div
        className="absolute inset-0 bg-[repeating-linear-gradient(-45deg,rgb(240_115_22_/_0.07)_0_12px,transparent_12px_24px)]"
        aria-hidden="true"
      />
      <div className="contenedor relative">
        <nav
          aria-label="Miga de pan"
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

        <h1 className="mt-3.5 text-[40px] font-extrabold leading-[1.08] tracking-[-0.035em]">
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
