/**
 * Un código de barras dibujado con rectángulos.
 *
 * Los módulos los arma Go (backend/internal/codigobarras): «1» es barra y «0»
 * espacio. Acá solo se juntan los unos seguidos en un rectángulo y se deja la
 * zona de silencio a los costados, que sin ella el lector no encuentra dónde
 * empieza. Sin librería ni fuente: un SVG escala a cualquier ancho y la
 * impresora lo imprime nítido.
 */

import { tramos } from "@/lib/etiquetas-de-medidas";

/** Módulos en blanco a cada lado: lo que piden EAN-13 (11/7) y Code 128 (10). */
const SILENCIO = 10;

export function CodigoDeBarras({
  modulos,
  etiqueta,
  className,
}: {
  modulos: string;
  /** Lo que lee un lector de pantalla: el código en texto. */
  etiqueta: string;
  className?: string;
}) {
  const ancho = modulos.length + SILENCIO * 2;
  return (
    <svg
      viewBox={`0 0 ${ancho} 40`}
      preserveAspectRatio="none"
      shapeRendering="crispEdges"
      role="img"
      aria-label={etiqueta}
      className={className}
    >
      <rect x={0} y={0} width={ancho} height={40} fill="#fff" />
      {tramos(modulos).map((t) => (
        <rect key={t.x} x={t.x + SILENCIO} y={0} width={t.ancho} height={40} fill="#000" />
      ))}
    </svg>
  );
}
