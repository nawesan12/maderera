import { TRAZO_ISOTIPO, TRAZO_NOMBRE, VISTA_ISOTIPO, VISTA_LOGOTIPO } from "@/lib/marca/logotipo";

/**
 * La marca: el logotipo de la guía de identidad, en vectores.
 *
 * Antes era la «M» en un PNG de 180 px y el nombre escrito en Geist. La guía
 * del estudio Ranina prohíbe ese «reemplazo tipográfico», y el PNG se pixelaba
 * al agrandarlo. Ahora es el logotipo apaisado del PDF de la guía
 * (`lib/marca/logotipo.ts`), con sus dos colores: la «m» en el naranja de la
 * marca y el nombre en `currentColor` —el gris #505052 de la guía sobre claro,
 * blanco sobre oscuro—.
 *
 * Una sola pieza para todo el sistema (notas del 9/11/2026: «más presencia a
 * la marca, logo y nombre más grandes en todos lados»).
 */
const ALTOS = {
  // Entre 1024 y 1280 la barra lleva todos los enlaces: ahí va un poco más
  // chica para no correr la página de costado.
  barra: "h-10 xl:h-12",
  pie: "h-12",
  panel: "h-8",
  grande: "h-16 sm:h-20",
} as const;

export function Logotipo({ className = "", titulo = true }: { className?: string; titulo?: boolean }) {
  return (
    <svg
      viewBox={VISTA_LOGOTIPO}
      className={`w-auto shrink-0 ${className}`}
      role={titulo ? "img" : undefined}
      aria-label={titulo ? "Maderera Juan B. Justo" : undefined}
      aria-hidden={titulo ? undefined : true}
    >
      <path className="fill-marca-naranja" fillRule="evenodd" d={TRAZO_ISOTIPO} />
      <path fill="currentColor" fillRule="evenodd" d={TRAZO_NOMBRE} />
    </svg>
  );
}

/** La «m» sola, en el color del texto (o el que diga `className`). */
export function Isotipo({ className = "" }: { className?: string }) {
  return (
    <svg viewBox={VISTA_ISOTIPO} className={`w-auto shrink-0 ${className}`} aria-hidden="true">
      <path fill="currentColor" fillRule="evenodd" d={TRAZO_ISOTIPO} />
    </svg>
  );
}

export function Marca({
  tamano = "barra",
  tono = "claro",
  etiqueta,
}: {
  tamano?: keyof typeof ALTOS;
  /** «oscuro» es sobre fondo oscuro: el pie, el menú del panel. */
  tono?: "claro" | "oscuro";
  /** Dónde se está: «Panel», «Taller». Va debajo, sin tocar el logotipo. */
  etiqueta?: string;
}) {
  const color = tono === "oscuro" ? "text-white" : "text-marca-gris dark:text-white";
  if (!etiqueta) return <Logotipo className={`${ALTOS[tamano]} ${color}`} />;
  return (
    <span className="flex flex-col items-start gap-1.5">
      <Logotipo className={`${ALTOS[tamano]} ${color}`} />
      <span
        className={`text-[10.5px] font-semibold uppercase tracking-[0.28em] ${
          tono === "oscuro" ? "text-white/60" : "text-texto-3"
        }`}
      >
        {etiqueta}
      </span>
    </span>
  );
}
