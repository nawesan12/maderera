import Link from "next/link";

/** Cuántas filas se muestran de un grupo largo antes de pedir el resto. */
export const TOPE_GRUPO = 30;

/**
 * Recorta un grupo largo y ofrece el resto en un enlace.
 *
 * Las pantallas del panel se dibujan enteras en el servidor, así que esconder
 * filas con CSS no ahorra nada: el HTML se genera igual y viaja igual. Con 500
 * variantes, Stock son varios megas por carga.
 *
 * Se recortan **todos** los grupos, incluido el que pide atención. La primera
 * versión dejaba entero el de atención con el argumento de que es la razón por
 * la que alguien abre la pantalla, y con 340 variantes sin stock la página
 * medía 3,3 MB: justamente el caso que había que resolver. El grupo que pide
 * atención puede ser el más largo de todos.
 *
 * No se esconde la magnitud: el encabezado del grupo sigue diciendo cuántos
 * son. Lo que se difiere son las filas.
 */
export function recortar<T>(
  filas: T[],
  verTodo: boolean,
): { visibles: T[]; ocultas: number } {
  if (verTodo || filas.length <= TOPE_GRUPO) {
    return { visibles: filas, ocultas: 0 };
  }
  return {
    visibles: filas.slice(0, TOPE_GRUPO),
    ocultas: filas.length - TOPE_GRUPO,
  };
}

/**
 * El enlace para ver el resto.
 *
 * Enlace y no botón: es una dirección, se comparte y anda sin JavaScript.
 * `scroll={false}` porque quien lo aprieta ya bajó hasta acá.
 */
export function VerTodo({
  ocultas,
  params,
}: {
  ocultas: number;
  /** Los filtros vigentes, para no perderlos al pedir el resto. */
  params: Record<string, string | undefined>;
}) {
  if (ocultas === 0) return null;

  const query = new URLSearchParams(
    Object.entries(params).filter(([, v]) => Boolean(v)) as [string, string][],
  );
  query.set("ver", "todo");

  return (
    <Link
      scroll={false}
      href={`?${query}`}
      className="mt-3 flex h-11 w-full items-center justify-center rounded-lg border border-dashed border-linea text-[15px] text-texto-2 transition-colors hover:bg-card hover:text-foreground"
    >
      Ver {ocultas} más
    </Link>
  );
}
