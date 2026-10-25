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

export async function listarProductosAdmin(filtros: { busqueda?: string; categoria?: string } = {}): Promise<ProductoAdmin[]> {
  const query = {
    ...(filtros.busqueda ? { busqueda: filtros.busqueda.slice(0, 200) } : {}),
    ...(filtros.categoria ? { categoria: filtros.categoria } : {}),
  };
  return datos(await (await api()).GET("/api/v1/admin/productos", { params: { query } }));
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

/** Las imputaciones contables ya usadas, para sugerirlas en la ficha. */
export async function imputacionesUsadas(): Promise<string[]> {
  return datos(await (await api()).GET("/api/v1/admin/productos-imputaciones"));
}
