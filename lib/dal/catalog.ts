import { cache } from "react";
import "server-only";

import { cachearPublico, ETIQUETAS } from "@/lib/cache-publico";
import { normalizarBusqueda } from "@/lib/busqueda";
import { api, apiInterna, apiPublica, datos } from "@/lib/api/servidor";
import { listaVigente } from "@/lib/dal/precios-sesion";
import type { StockLevel } from "@/lib/stock-level";

/**
 * El catálogo público.
 *
 * **La lógica vive en la API de Go** (backend/internal/catalogo): el precio
 * por lista con su respaldo a la general y el factor de las listas derivadas,
 * la oferta de la variante más barata, el stock combinado de las sucursales y
 * el orden. Acá quedan los nombres y tipos que usan las páginas, y la caché
 * de Next.
 *
 * Dos reglas que no se aflojan:
 *
 * - **Lo que se guarda en la caché compartida se pide sin la sesión**
 *   (`apiPublica`, `publico=true`): a precio de público, igual para todos. Un
 *   precio de lista propia ahí se le serviría a cualquiera.
 * - Lo que depende de quién mira (`listarProductos`, los precios por variante,
 *   los complementos del carrito) se pide con la cookie y no se cachea entre
 *   personas.
 *
 * Las respuestas de Go tienen exactamente estas formas: se compararon campo
 * por campo con la implementación anterior en TypeScript (143 casos, con
 * ofertas vencidas y vigentes y una lista derivada) antes de reemplazarla.
 */

export interface ProductoListado {
  id: string;
  slug: string;
  name: string;
  description: string;
  subcategory: string | null;
  /** Slug del rubro, para poder enlazar al filtro desde la tarjeta. */
  subcategorySlug: string | null;
  subcategoryName: string | null;
  brand: string | null;
  unit: string;
  /** Con qué alícuota se factura. La vitrina la necesita para desagregar bien. */
  alicuotaIva: string;
  /** Se fabrica a pedido: la ficha lo dice en vez de mostrarlo como agotado. */
  aPedido: boolean;
  /** Cómo se vende la placa: entera, entera o media, por m². */
  formaDeVenta: "entera" | "entera_o_media" | "metro_cuadrado";
  /** Precio de la media placa, en % de la entera. */
  precioMediaPct: number;
  featured: boolean;
  categorySlug: string;
  categoryName: string;
  image: string | null;
  /** Precio más bajo entre las variantes, para el "desde $…". */
  precioDesde: string | null;
  /** Precio anterior, si el producto está en oferta. */
  precioAnterior: string | null;
  /** Descuento en porcentaje, ya redondeado. */
  descuento: number | null;
  labels: string[];
  stockCentral: StockLevel;
  stockAserradero: StockLevel;
  hayStock: boolean;
}

export type OrdenCatalogo = "relevancia" | "precio-asc" | "precio-desc" | "nombre";

export interface FiltrosCatalogo {
  categoria?: string;
  /** El rubro dentro de la categoría, por slug. */
  subcategoria?: string;
  busqueda?: string;
  stock?: "todos" | "en-stock" | "casa-central" | "aserradero";
  orden?: OrdenCatalogo;
  /** Solo los que están en oferta. */
  soloOfertas?: boolean;
  /** Solo los de una marca (la sección de Moldava). */
  marca?: string;
  /** Un conjunto puntual de productos, por id (los sugeridos). */
  ids?: string[];
}

export interface VarianteDetalle {
  id: string;
  sku: string;
  label: string;
  material: string | null;
  color: string | null;
  terminacion: string | null;
  calidad: string | null;
  largoMm: number | null;
  anchoMm: number | null;
  espesorMm: number | null;
  precio: string | null;
  stockCentral: StockLevel;
  stockAserradero: StockLevel;
  /**
   * Cuántas unidades quedan entre las dos sucursales. La ficha lo muestra
   * solo cuando el nivel es bajo, como promoción.
   */
  disponibles: number;
}

export interface ProductoDetalle {
  id: string;
  slug: string;
  name: string;
  description: string;
  subcategory: string | null;
  subcategorySlug: string | null;
  subcategoryName: string | null;
  brand: string | null;
  unit: string;
  alicuotaIva: string;
  aPedido: boolean;
  formaDeVenta: "entera" | "entera_o_media" | "metro_cuadrado";
  precioMediaPct: number;
  featured: boolean;
  categorySlug: string;
  categoryName: string;
  imagenes: string[];
  variantes: VarianteDetalle[];
}

export interface PaginaDeCatalogo {
  productos: ProductoListado[];
  total: number;
  hayMas: boolean;
  topeAlcanzado: boolean;
}

export interface Sugeridos {
  /** Lo que hace falta para usar el producto: los clavos del machimbre. */
  complementarios: ProductoListado[];
  /** La alternativa, cuando lo que se está mirando no convence o no hay stock. */
  similares: ProductoListado[];
  /** `true` cuando los similares salieron de la categoría y no de una carga. */
  similaresPorCategoria: boolean;
}

/** Cuántos productos entran en una página del catálogo (el de Go: PorPagina). */
export const POR_PAGINA = 24;

/** El año de fundación vive en `lib/empresa.ts`; se reexporta por los que ya lo importaban de acá. */
export { ANIO_FUNDACION } from "@/lib/empresa";

/** Los filtros como parámetros de la API. */
function consulta(filtros: FiltrosCatalogo) {
  return {
    categoria: filtros.categoria,
    subcategoria: filtros.subcategoria,
    busqueda: filtros.busqueda ? normalizarBusqueda(filtros.busqueda) : undefined,
    stock: filtros.stock,
    orden: filtros.orden,
    soloOfertas: filtros.soloOfertas,
    marca: filtros.marca,
    ids: filtros.ids?.join(","),
  };
}

/** Los mismos filtros con la búsqueda canónica: son la clave de la caché. */
function claveDeFiltros(filtros: FiltrosCatalogo): FiltrosCatalogo {
  return filtros.busqueda ? { ...filtros, busqueda: normalizarBusqueda(filtros.busqueda) } : filtros;
}

/** Categorías con la cantidad real de productos activos. */
export const listarCategorias = cache(
  cachearPublico(
    async () => datos(await apiPublica.GET("/api/v1/catalogo/categorias")),
    ["categorias"],
    ETIQUETAS.catalogo,
  ),
);

/** Las marcas del catálogo, o las de una categoría. */
export const marcasDelCatalogo = cache(
  cachearPublico(
    async (categoria?: string) =>
      datos(await apiPublica.GET("/api/v1/catalogo/marcas", { params: { query: { categoria } } })),
    ["marcas"],
    ETIQUETAS.catalogo,
  ),
);

/** Los rubros de una categoría que tienen algo cargado. */
export const rubrosDeCategoria = cache(
  cachearPublico(
    async (categoria: string) =>
      datos(await apiPublica.GET("/api/v1/catalogo/rubros", { params: { query: { categoria } } })),
    ["subcategorias"],
    ETIQUETAS.catalogo,
  ),
);

const productosPublicosCacheados = cachearPublico(
  async (filtros: FiltrosCatalogo): Promise<ProductoListado[]> =>
    datos(
      await apiPublica.GET("/api/v1/catalogo/productos", {
        params: { query: { ...consulta(filtros), publico: true } },
      }),
    ) as ProductoListado[],
  ["catalogo", "productos"],
  ETIQUETAS.catalogo,
);

/**
 * El catálogo **sin preguntar quién mira**, siempre a precio de público. Es lo
 * que deja servir la portada y el catálogo desde la caché; el precio del
 * profesional llega aparte, en `lib/dal/visitante.ts`.
 */
export async function listarProductosPublicos(filtros: FiltrosCatalogo = {}): Promise<ProductoListado[]> {
  if (filtros.ids && filtros.ids.length === 0) return [];
  return productosPublicosCacheados(claveDeFiltros(filtros));
}

/*
 * La caché **por lista**, como la tenía el TS: la clave es la lista y su
 * factor, no la persona, así que todos los profesionales con la misma lista
 * comparten el resultado, y la invalida la misma etiqueta que las escrituras
 * del catálogo. El factor va en la clave: si cambia el porcentaje de una lista
 * derivada, lo viejo deja de servirse. Sin esto, cada carga del catálogo de un
 * profesional armaba los 2000 productos de nuevo.
 */
const productosPorListaCacheados = cachearPublico(
  async (filtros: FiltrosCatalogo, lista: string, _factor: number): Promise<ProductoListado[]> =>
    datos(
      await apiInterna.GET("/api/v1/catalogo/productos", { params: { query: { ...consulta(filtros), lista } } }),
    ) as ProductoListado[],
  ["catalogo", "productos-por-lista"],
  ETIQUETAS.catalogo,
);

/** El catálogo a la lista de quien mira. */
export async function listarProductos(filtros: FiltrosCatalogo = {}): Promise<ProductoListado[]> {
  if (filtros.ids && filtros.ids.length === 0) return [];
  const lista = await listaVigente();
  if (!lista.esDiferenciada || !lista.id) return listarProductosPublicos(filtros);
  return productosPorListaCacheados(claveDeFiltros(filtros), lista.id, lista.factorDerivado);
}

/**
 * Los productos en oferta para quien mira, memoizados: el catálogo arma el
 * panel de filtros dos veces (el cajón del teléfono y la columna del
 * escritorio) y las dos los piden.
 */
export const productosEnOferta = cache(() => listarProductos({ soloOfertas: true }));

/**
 * Una página del catálogo a precio de público, con el total para decir «viste
 * N de M». El recorte y el tope (5 páginas, que evita ?pagina=9999) los hace Go.
 */
const paginaCacheada = cachearPublico(
  async (filtros: FiltrosCatalogo, pagina: number): Promise<PaginaDeCatalogo> => {
    if (filtros.ids && filtros.ids.length === 0) {
      return { productos: [], total: 0, hayMas: false, topeAlcanzado: false };
    }
    return datos(
      await apiPublica.GET("/api/v1/catalogo/productos/pagina", {
        params: { query: { ...consulta(filtros), pagina: Math.max(1, Math.floor(pagina) || 1), publico: true } },
      }),
    ) as PaginaDeCatalogo;
  },
  ["catalogo", "pagina"],
  ETIQUETAS.catalogo,
);

export function paginaDeProductosPublica(filtros: FiltrosCatalogo = {}, pagina = 1): Promise<PaginaDeCatalogo> {
  return paginaCacheada(claveDeFiltros(filtros), pagina);
}

/**
 * La ficha **a precio de público**, la misma para todo el que entre (el precio
 * de la lista propia lo corrige `preciosDeFicha`). Null si no existe o está
 * dada de baja. Memoizada por pedido: la página y su `generateMetadata` piden
 * la misma.
 */
export const obtenerProductoPublico = cache(
  cachearPublico(
    async (slug: string): Promise<ProductoDetalle | null> => {
      const r = await apiPublica.GET("/api/v1/catalogo/productos/{slug}", {
        params: { path: { slug }, query: { publico: true } },
      });
      if (r.response.status === 404) return null;
      return datos(r) as ProductoDetalle;
    },
    ["catalogo", "producto"],
    ETIQUETAS.catalogo,
  ),
);

/**
 * Qué precio tiene cada variante para la lista de quien pide. Vacío para la
 * lista general: no hay nada que corregir.
 */
export async function preciosPropiosPorVariante(): Promise<Record<string, string>> {
  const lista = await listaVigente();
  if (!lista.esDiferenciada || !lista.id) return {};
  return preciosPorListaCacheados(lista.id, lista.factorDerivado);
}

/** Por lista, como el listado. */
const preciosPorListaCacheados = cachearPublico(
  async (lista: string, _factor: number): Promise<Record<string, string>> =>
    datos(await apiInterna.GET("/api/v1/catalogo/precios-por-variante", { params: { query: { lista } } })),
  ["catalogo", "precios-por-lista"],
  ETIQUETAS.catalogo,
);

/**
 * Los sugeridos de una ficha: los que cargó el vendedor, y si no cargó
 * similares, otros de la categoría. A precio de público, como la ficha.
 */
const sugeridosCacheados = cachearPublico(
  async (productId: string, categorySlug: string, excluirSlug: string, limite: number): Promise<Sugeridos> =>
    datos(
      await apiPublica.GET("/api/v1/catalogo/productos/{id}/sugeridos", {
        params: { path: { id: productId }, query: { categoria: categorySlug, excluir: excluirSlug, limite } },
      }),
    ) as Sugeridos,
  ["catalogo", "sugeridos"],
  ETIQUETAS.catalogo,
);

export function productosSugeridos(productId: string, categorySlug: string, excluirSlug: string, limite = 4): Promise<Sugeridos> {
  return sugeridosCacheados(productId, categorySlug, excluirSlug, limite);
}

/** Complementos de lo que ya está en el carrito, con stock, a la lista de quien mira. */
export async function complementosDelCarrito(variantIds: string[], limite = 4): Promise<ProductoListado[]> {
  const variantes = variantIds.filter(Boolean);
  if (variantes.length === 0) return [];
  return datos(
    await (await api()).POST("/api/v1/catalogo/complementos", { body: { variantes, limite } }),
  ) as ProductoListado[];
}

/** Los números que la página «Nosotros» muestra en grande, contados en la base. */
export const numerosDeLaEmpresa = cache(
  cachearPublico(
    async () => datos(await apiPublica.GET("/api/v1/catalogo/numeros")),
    ["numeros-de-la-empresa"],
    ETIQUETAS.catalogo,
  ),
);

/** Todo lo que la portada necesita, en una sola pasada y a precio de público. */
export const datosDePortada = cachearPublico(
  async () => {
    const p = datos(await apiPublica.GET("/api/v1/catalogo/portada"));
    return {
      ...p,
      ofertas: p.ofertas as ProductoListado[],
      destacados: p.destacados as ProductoListado[],
    };
  },
  ["portada"],
  ETIQUETAS.catalogo,
);
