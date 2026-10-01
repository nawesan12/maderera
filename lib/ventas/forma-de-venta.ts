/**
 * Cómo se vende una placa y cuánto stock descuenta cada línea.
 *
 * De la clienta (30/9/2026): «hay placas que se venden sí o sí enteras o por
 * la mitad. O sea de qué forma se vende la placa, o si es por metro cuadrado».
 *
 * Todas las cuentas viven acá para que la tienda, el carrito, el mostrador, el
 * presupuesto y el corte digan lo mismo. Cada uno armaba antes su propia
 * versión de «media placa», y la del corte cobraba la mitad pero descontaba una
 * placa entera.
 *
 * Es lógica pura: corre en el servidor y en el navegador.
 */

import { cantidadDeStock } from "@/lib/unidades";

export type FormaDeVenta = "entera" | "entera_o_media" | "metro_cuadrado";

/** Media placa partida al largo o al ancho. `null` es la unidad tal cual. */
export type Presentacion = "media_largo" | "media_ancho" | null;

export const PRESENTACIONES = ["media_largo", "media_ancho"] as const;

export function esPresentacion(valor: unknown): valor is Exclude<Presentacion, null> {
  return valor === "media_largo" || valor === "media_ancho";
}

/** Lo que hace falta saber del producto para vender una línea. */
export interface ProductoQueSeVende {
  unit: string;
  formaDeVenta: FormaDeVenta;
  precioMediaPct: number;
  /** Medidas de la variante, en milímetros. */
  largoMm?: number | null;
  anchoMm?: number | null;
}

/** Si la forma de venta aplica: solo a las placas. */
function esPlaca(p: Pick<ProductoQueSeVende, "unit">): boolean {
  return p.unit === "placa";
}

export function admiteMedia(p: Pick<ProductoQueSeVende, "unit" | "formaDeVenta">): boolean {
  return esPlaca(p) && p.formaDeVenta === "entera_o_media";
}

export function seVendePorM2(p: Pick<ProductoQueSeVende, "unit" | "formaDeVenta">): boolean {
  return esPlaca(p) && p.formaDeVenta === "metro_cuadrado";
}

/** Superficie de la placa en m², o null si la variante no tiene medidas. */
export function areaDePlacaM2(largoMm?: number | null, anchoMm?: number | null): number | null {
  if (!largoMm || !anchoMm || largoMm <= 0 || anchoMm <= 0) return null;
  return (largoMm * anchoMm) / 1_000_000;
}

/**
 * Precio de una media placa a partir del de la entera.
 *
 * Se redondea al peso: es un precio de lista que se imprime, no un cálculo
 * intermedio. Sobre la lista que corresponda —la del profesional también—.
 */
export function precioDeMedia(precioEntera: number, pct: number): number {
  return Math.round((precioEntera * pct) / 100);
}

/**
 * Precio unitario de una línea según su presentación.
 *
 * Para la placa por m² el precio de lista ya es por m² y no cambia: la
 * cantidad es la que viene en m².
 */
export function precioDeLinea(
  precioDeLista: number,
  producto: Pick<ProductoQueSeVende, "unit" | "formaDeVenta" | "precioMediaPct">,
  presentacion: Presentacion,
): number {
  if (presentacion && admiteMedia(producto)) {
    return precioDeMedia(precioDeLista, producto.precioMediaPct);
  }
  return precioDeLista;
}

/**
 * Cuánto stock descuenta cada unidad vendida.
 *
 * - Media placa: 0,5 placas, sea al largo o al ancho.
 * - Placa por m²: 1 / área. Sin medidas cargadas no se puede convertir, y
 *   devolver 1 descontaría una placa por cada m²: se lanza el error para que
 *   el producto no se pueda vender así hasta que tenga medidas.
 * - Todo lo demás: 1, porque el stock se lleva en la unidad de venta.
 */
export function factorDeStock(
  producto: ProductoQueSeVende,
  presentacion: Presentacion,
): number {
  if (presentacion && admiteMedia(producto)) return 0.5;
  if (seVendePorM2(producto)) {
    const area = areaDePlacaM2(producto.largoMm, producto.anchoMm);
    if (!area) {
      throw new Error(
        "La placa se vende por m² pero la variante no tiene largo y ancho cargados.",
      );
    }
    return 1 / area;
  }
  return 1;
}

/** Unidades de stock que mueve una línea: cantidad × factor, a tres decimales. */
export function unidadesDeStock(cantidad: number, stockPorUnidad: number): number {
  return cantidadDeStock(cantidad * stockPorUnidad);
}

/** Unidad con la que se guarda la línea: la placa por m² se vende en m². */
export function unidadDeLinea(
  producto: Pick<ProductoQueSeVende, "unit" | "formaDeVenta">,
): string {
  return seVendePorM2(producto) ? "metro_cuadrado" : producto.unit;
}

/** La presentación que corresponde a un corte hecho sobre media placa. */
export function presentacionDeMitad(mitad: "largo" | "ancho" | null): Presentacion {
  if (mitad === "largo") return "media_largo";
  if (mitad === "ancho") return "media_ancho";
  return null;
}

/** «Media placa al largo», para el renglón del ticket, la factura y el remito. */
export function nombreDePresentacion(presentacion: Presentacion): string | null {
  if (presentacion === "media_largo") return "Media placa, al largo";
  if (presentacion === "media_ancho") return "Media placa, al ancho";
  return null;
}

/** Descripción de la línea con la presentación al final, si la hay. */
export function descripcionConPresentacion(
  descripcion: string,
  presentacion: Presentacion,
): string {
  const nombre = nombreDePresentacion(presentacion);
  return nombre ? `${descripcion} — ${nombre}` : descripcion;
}
