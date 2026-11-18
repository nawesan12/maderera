import "server-only";

import { api, datos } from "@/lib/api/servidor";

/**
 * La gestión de productos del panel. La sirve la API de Go
 * (backend/internal/productos), que exige la sesión del panel: leer, cualquier
 * persona del panel; escribir, quien entra a /admin/productos.
 *
 * Las formas son las de antes (las de drizzle), para que las pantallas no
 * cambien: precios como texto, cantidades como número.
 */

export interface ProductoAdmin {
  id: string;
  slug: string;
  name: string;
  categoryName: string;
  brand: string | null;
  unit: string;
  featured: boolean;
  active: boolean;
  variantes: number;
  stockTotal: number;
  imagen: string | null;
  /** Precio más bajo entre las variantes, para el "desde". */
  precioDesde: string | null;
  sinFoto: boolean;
}

/**
 * Los filtros de los tres listados largos (productos, precios y stock), como
 * vienen de la URL. Los aplica Go: acá viaja una página y los totales.
 */
export interface FiltrosDeCatalogo {
  busqueda?: string;
  categoria?: string;
  /** El grupo de cada pantalla («sin-precio», «sin-stock»…). */
  estado?: string;
  marca?: string;
  proveedor?: string;
  /** Desde 1. */
  pagina?: number;
}

/** Los filtros como parámetros de la API, con la página pasada a desplazamiento. */
export function consultaDeCatalogo(f: FiltrosDeCatalogo, porPagina: number) {
  const pagina = f.pagina && f.pagina > 1 ? Math.floor(f.pagina) : 1;
  return {
    ...(f.busqueda ? { busqueda: f.busqueda.slice(0, 200) } : {}),
    ...(f.categoria && f.categoria !== "todos" ? { categoria: f.categoria } : {}),
    ...(f.marca && f.marca !== "todas" ? { marca: f.marca.slice(0, 120) } : {}),
    ...(f.proveedor && f.proveedor !== "todos" ? { proveedor: f.proveedor } : {}),
    limite: porPagina,
    desplazamiento: (pagina - 1) * porPagina,
  };
}

/** Cuántos productos trae cada página: múltiplo de 2, 3 y 4, las columnas de la grilla. */
export const PRODUCTOS_POR_PAGINA = 36;

const ESTADOS_DE_PRODUCTO = ["sin-foto", "sin-precio", "sin-stock", "ocultos"] as const;
export type EstadoDeProducto = (typeof ESTADOS_DE_PRODUCTO)[number];

/** El estado de la URL, o undefined si no es uno de los que conoce Go. */
export function estadoDeProducto(v: string | undefined): EstadoDeProducto | undefined {
  return ESTADOS_DE_PRODUCTO.find((e) => e === v);
}

/** Una página del listado. `porPagina` lo achica quien busca para sugerir. */
export async function listarProductosAdmin(filtros: FiltrosDeCatalogo = {}, porPagina = PRODUCTOS_POR_PAGINA) {
  const estado = estadoDeProducto(filtros.estado);
  const query = { ...consultaDeCatalogo(filtros, porPagina), ...(estado ? { estado } : {}) };
  const r = datos(await (await api()).GET("/api/v1/admin/productos", { params: { query } }));
  return { ...r, filas: r.filas as ProductoAdmin[] };
}

/** Las marcas cargadas, para el filtro de los listados. */
export async function marcasDeProductos(): Promise<string[]> {
  return datos(await (await api()).GET("/api/v1/admin/productos-marcas"));
}

/**
 * Lo que va en cada etiqueta: nombre corto, medida, código y el código de
 * barras ya armado por Go (EAN-13 o Code 128). Una por medida; las
 * cantidades las pone la hoja.
 */
export async function datosDeEtiquetas(pedido: { medidas?: string[]; productos?: string[]; precio?: boolean }) {
  const query = {
    ...(pedido.medidas?.length ? { medidas: pedido.medidas.join(",") } : {}),
    ...(pedido.productos?.length ? { productos: pedido.productos.join(",") } : {}),
    precio: Boolean(pedido.precio),
  };
  return datos(await (await api()).GET("/api/v1/admin/etiquetas", { params: { query } }));
}

/** Producto completo para el formulario de edición, o null si no existe. */
export async function obtenerProductoAdmin(id: string) {
  const r = await (await api()).GET("/api/v1/admin/productos/{id}", { params: { path: { id } } });
  if (r.response.status === 404 || r.response.status === 400) return null;
  const p = datos(r);
  return { ...p, createdAt: new Date(p.createdAt), updatedAt: new Date(p.updatedAt) };
}

export async function listarCategoriasAdmin() {
  return datos(await (await api()).GET("/api/v1/admin/categorias"));
}

/**
 * Todos los rubros, con su categoría, también los inactivos: un producto puede
 * estar en un rubro que se dio de baja y la ficha tiene que poder mostrarlo.
 */
export async function listarRubrosAdmin() {
  return datos(await (await api()).GET("/api/v1/admin/rubros"));
}

/** Los rubros agrupados por categoría, con cuántos productos tienen y cuántos quedan sueltos. */
export async function rubrosPorCategoria() {
  return datos(await (await api()).GET("/api/v1/admin/rubros/por-categoria"));
}

export interface CandidatoDeBaja {
  id: string;
  nombre: string;
  slug: string;
  categoria: string;
  /** Días desde la última venta. Null si nunca se vendió. */
  diasSinVender: number | null;
  /** Unidades disponibles hoy, sumando las dos sucursales. */
  stock: number;
  /** Cuántas de sus medidas no tienen precio en ninguna lista. */
  variantesSinPrecio: number;
  variantes: number;
  /** Por qué aparece en la lista. */
  motivos: string[];
}

/**
 * Productos que quizá haya que dar de baja, con el umbral guardado. **No da de
 * baja nada**: arma la lista y alguien decide.
 */
export async function candidatosDeBaja(): Promise<{ meses: number; candidatos: CandidatoDeBaja[] }> {
  return datos(await (await api()).GET("/api/v1/admin/productos-candidatos"));
}

export interface SugeridoCargado {
  id: string;
  relatedProductId: string;
  nombre: string;
  categoria: string;
  imagen: string | null;
  activo: boolean;
  tipo: "complementario" | "similar";
  orden: number;
}

/** Los sugeridos ya cargados de un producto. */
export async function sugeridosDelProducto(productId: string): Promise<SugeridoCargado[]> {
  return datos(await (await api()).GET("/api/v1/admin/productos/{id}/sugeridos", { params: { path: { id: productId } } }));
}

/** Los productos activos menos el propio, para el buscador de sugeridos (filtra el navegador). */
export async function candidatosParaSugerir(productId: string) {
  return datos(await (await api()).GET("/api/v1/admin/productos/{id}/para-sugerir", { params: { path: { id: productId } } }));
}

/** Material, color, terminación y calidad ya cargados, para sugerirlos. */
export async function atributosUsados() {
  return datos(await (await api()).GET("/api/v1/admin/productos-atributos"));
}

/** Las imputaciones contables ya usadas, para sugerirlas en la ficha. */
export async function imputacionesUsadas(): Promise<string[]> {
  return datos(await (await api()).GET("/api/v1/admin/productos-imputaciones"));
}
