/**
 * El personaje del asistente.
 *
 * Antes era `Sparkles` de lucide: el ícono de "esto lo hizo una inteligencia
 * artificial" que usa media web. La clienta pidió cambiarlo por un personaje,
 * y tiene razón por dos motivos. El asistente de este sitio **no es un modelo
 * de lenguaje** —es un guion con respuestas escritas y búsqueda en el
 * catálogo—, así que las chispitas prometen algo que no hace. Y un personaje
 * propio es de la maderera; las chispitas no son de nadie.
 *
 * Es un tablón con cara, dibujado con el trazo de la tipografía de íconos del
 * resto del sitio para que conviva con ellos. Usa `currentColor`, así que
 * sirve en blanco sobre el botón naranja y en naranja sobre el fondo claro del
 * encabezado, sin dos versiones del archivo.
 */
export function PersonajeAsistente({
  className = "h-6 w-6",
}: {
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {/* El tablón */}
      <rect x="3" y="5" width="18" height="14" rx="3" />

      {/* Las vetas de la madera, arriba y abajo de la cara */}
      <path d="M6.5 8.2c1.6-.9 3.2-.9 4.8 0" opacity={0.55} />
      <path d="M6.5 15.9c2.6 1 5.2 1 7.8 0" opacity={0.55} />

      {/* Los ojos */}
      <path d="M9.5 11.4v1.1" />
      <path d="M14.5 11.4v1.1" />

      {/* La sonrisa */}
      <path d="M10.2 14.4c1.1.8 2.5.8 3.6 0" />
    </svg>
  );
}
