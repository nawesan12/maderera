/**
 * Encabezado de grupo dentro de un listado.
 *
 * Separar lo abierto de lo cerrado es lo que responde "qué tengo que hacer hoy"
 * sin leer fila por fila. Una lista larga y pareja obliga a revisar cada estado
 * uno por uno para encontrar los tres que importan.
 *
 * **Un grupo vacío se muestra igual, con su cero.** Antes devolvía `null` y
 * desaparecía, que parece prolijo y no lo es: "Sin entregar" ausente y "Sin
 * entregar 0" dicen cosas distintas. El primero se lee como que la pantalla no
 * tiene ese grupo; el segundo, como que no queda nada pendiente, que es la
 * respuesta que se vino a buscar. Quien quiera esconderlo pasa `ocultarVacio`.
 */
export function GrupoListado({
  titulo,
  cantidad,
  detalle,
  destacado = false,
  ocultarVacio = false,
  vacio,
  children,
}: {
  titulo: string;
  cantidad: number;
  detalle?: string;
  destacado?: boolean;
  /** Para las listas donde el grupo sin filas de verdad no aporta nada. */
  ocultarVacio?: boolean;
  /** Qué decir cuando el grupo está en cero. Por omisión, una raya. */
  vacio?: React.ReactNode;
  children: React.ReactNode;
}) {
  if (cantidad === 0 && ocultarVacio) return null;

  return (
    <section className="mt-[22px]">
      <div className="mb-[11px] flex flex-wrap items-baseline gap-2.5">
        <h2
          className={`text-[17px] font-semibold tracking-[-0.015em] ${
            destacado ? "" : "text-texto-2"
          }`}
        >
          {titulo}
        </h2>
        <span
          className={`tabular rounded-full px-2.5 py-0.5 text-[13px] font-semibold ${
            destacado
              ? "bg-brand-orange/15 text-brand-orange-dark dark:text-acento-texto"
              : "bg-chip text-texto-2"
          }`}
        >
          {cantidad}
        </span>
        {detalle && <span className="text-sm text-texto-2">{detalle}</span>}
      </div>
      <div className="space-y-3">
        {cantidad === 0
          ? (vacio ?? (
              /* Una línea y no una caja: el grupo vacío es una confirmación,
                 no un aviso. Ocupar el alto de una tarjeta para decir que no
                 hay nada empuja hacia abajo lo que sí importa. */
              <p className="px-1 text-base text-texto-2">Nada por acá.</p>
            ))
          : children}
      </div>
    </section>
  );
}
