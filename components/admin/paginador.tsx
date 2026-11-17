import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";

/** Cuántas filas trae cada página de los listados largos del panel. */
export const POR_PAGINA = 30;

/** La página pedida en la URL: 1 si falta o no es un número. */
export function leerPagina(valor: string | undefined): number {
  const n = Math.floor(Number(valor));
  return Number.isFinite(n) && n > 1 ? n : 1;
}

/**
 * Anterior y siguiente de un listado que se pide de a páginas al servidor.
 *
 * Reemplaza los topes que cortaban en 30, 200 o 500 filas sin decir nada: el
 * total viene del servidor, así que se sabe cuántas páginas hay y lo que no se
 * ve está a un clic. Son enlaces (se comparten y andan sin JavaScript) y
 * conservan los demás filtros de la URL.
 *
 * `nombre` es el parámetro de la página: una pantalla con dos listados
 * paginados usa uno distinto para cada uno.
 */
export function Paginador({
  pagina,
  total,
  porPagina = POR_PAGINA,
  params,
  nombre = "pagina",
}: {
  pagina: number;
  total: number;
  porPagina?: number;
  /** Los filtros vigentes, para no perderlos al cambiar de página. */
  params: Record<string, string | undefined>;
  nombre?: string;
}) {
  const paginas = Math.max(1, Math.ceil(total / porPagina));
  if (paginas <= 1) return null;

  const enlace = (n: number) => {
    const q = new URLSearchParams(
      Object.entries(params).filter(([, v]) => Boolean(v)) as [string, string][],
    );
    if (n > 1) q.set(nombre, String(n));
    else q.delete(nombre);
    return `?${q}`;
  };

  const clase =
    "tarjeta inline-flex h-11 items-center gap-1.5 px-4 text-base font-semibold transition-colors hover:text-acento-texto";

  return (
    <nav
      aria-label="Páginas"
      className="flex items-center justify-between gap-3 px-1 py-3 text-base"
    >
      {pagina > 1 ? (
        <Link href={enlace(pagina - 1)} scroll={false} className={clase}>
          <ChevronLeft className="h-5 w-5" />
          Anterior
        </Link>
      ) : (
        <span />
      )}
      <span className="tabular text-texto-2">
        Página {Math.min(pagina, paginas)} de {paginas}
      </span>
      {pagina < paginas ? (
        <Link href={enlace(pagina + 1)} scroll={false} className={clase}>
          Siguiente
          <ChevronRight className="h-5 w-5" />
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}
