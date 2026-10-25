import "server-only";

import { cachearPublico, ETIQUETAS } from "@/lib/cache-publico";
import { apiPublica, datos } from "@/lib/api/servidor";

/**
 * Lo que va al sitemap, y solo eso.
 *
 * Consulta propia y no reutiliza los listados del catálogo a propósito:
 * `listarProductos` trae precios, stock y fotos por producto, que para armar
 * una lista de URLs es traer media base al pedo. Acá alcanza con el slug, la
 * fecha del último cambio y las fotos.
 */

export interface RutaSitemap {
  ruta: string;
  actualizada: Date;
  imagenes?: string[];
}

/*
 * Las arma la API de Go (backend/internal/contenido/sitio.go). Cada sección
 * va en su caché con su etiqueta: el catálogo cambia con los precios, los
 * eventos con las inscripciones.
 */
function seccion(nombre: "catalogo" | "categorias" | "eventos", etiqueta: string) {
  const cacheada = cachearPublico(
    async () =>
      datos(await apiPublica.GET("/api/v1/contenido/sitemap/{seccion}", { params: { path: { seccion: nombre } } })),
    [`sitemap-${nombre}-v3`],
    etiqueta,
  );
  return async (): Promise<RutaSitemap[]> =>
    (await cacheada()).map((f) => ({ ...f, actualizada: new Date(f.actualizada) }));
}

/** Las fichas de producto activas, con la fecha del último cambio de precio o variante. */
export const rutasDelCatalogo = seccion("catalogo", ETIQUETAS.catalogo);

/** Las categorías y rubros que tienen algún producto activo. */
export const rutasDeCategorias = seccion("categorias", ETIQUETAS.catalogo);

/** Los eventos publicados que no pasaron. */
export const rutasDeEventos = seccion("eventos", ETIQUETAS.eventos);
