/**
 * Salto al contenido principal.
 *
 * En el sitio hacían falta catorce tabulaciones para pasar del encabezado al
 * contenido, y esas catorce se repetían en cada página que se visitaba. Es el
 * caso exacto que cubre el criterio 2.4.1 de WCAG: dar una forma de saltear los
 * bloques que se repiten.
 *
 * Está oculto hasta que recibe el foco, así que no cambia nada de lo que se ve
 * con el mouse. Va primero en el orden del documento a propósito: tiene que ser
 * lo primero que encuentra el Tab.
 */
export function SaltarAlContenido({ destino = "#contenido" }: { destino?: string }) {
  return (
    <a
      href={destino}
      className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-lg focus:bg-accion focus:px-4 focus:py-2.5 focus:text-base focus:font-medium focus:text-white focus:shadow-lg focus:outline-none focus:ring-3 focus:ring-ring/50"
    >
      Saltar al contenido
    </a>
  );
}
