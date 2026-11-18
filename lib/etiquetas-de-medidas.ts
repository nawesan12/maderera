import { esUuid } from "@/lib/uuid";

/**
 * Las etiquetas con código de barras de las medidas: qué se pide en la URL y
 * cómo se reparte en hojas.
 *
 * El pedido viaja en la URL (`?m=<id>*3,<id>`) para que la hoja se pueda
 * abrir en otra pestaña, recargar y volver a imprimir sin guardar nada.
 */

export interface PedidoDeEtiqueta {
  id: string;
  cantidad: number;
}

/** Etiquetas de una misma medida: más que esto es un cero de más. */
export const TOPE_POR_MEDIDA = 200;

/** Etiquetas por impresión: una resma de A4 son 500 hojas de 21. */
export const TOPE_DE_ETIQUETAS = 1000;

/**
 * Medidas distintas por impresión: el tope de Go (TopeDeEtiquetas en
 * backend/internal/productos/etiquetas.go). Con más, Go rechazaba el pedido y
 * la hoja daba error.
 */
export const TOPE_DE_MEDIDAS = 300;

/**
 * Los formatos. El A4 es la plancha autoadhesiva de 3 × 7 (63,5 × 38,1 mm,
 * la más común en librerías); el rollo, el de la impresora térmica de
 * etiquetas de 50 × 25 mm, una etiqueta por página.
 */
export const FORMATOS_DE_ETIQUETA = {
  a4: { porHoja: 21, ancho: 63.5, alto: 38.1 },
  rollo: { porHoja: 1, ancho: 50, alto: 25 },
} as const;
export type FormatoDeEtiqueta = keyof typeof FORMATOS_DE_ETIQUETA;

export function formatoDeEtiqueta(v: string | undefined): FormatoDeEtiqueta {
  return v === "rollo" ? "rollo" : "a4";
}

/**
 * Lee `id*3,id`: ids válidos, cantidades enteras de 1 a TOPE_POR_MEDIDA (sin
 * cantidad, una), una medida repetida suma, y ni el total ni las medidas
 * distintas pasan de sus topes.
 */
export function leerPedidoDeEtiquetas(m: string | string[] | undefined): PedidoDeEtiqueta[] {
  const texto = Array.isArray(m) ? m.join(",") : (m ?? "");
  const por = new Map<string, number>();
  for (const parte of texto.split(",")) {
    const [id, n] = parte.trim().split("*");
    if (!id || !esUuid(id)) continue;
    const pedida = n === undefined ? 1 : Math.floor(Number(n));
    if (!Number.isFinite(pedida) || pedida < 1) continue;
    por.set(id, Math.min((por.get(id) ?? 0) + pedida, TOPE_POR_MEDIDA));
  }
  const out: PedidoDeEtiqueta[] = [];
  let total = 0;
  for (const [id, cantidad] of por) {
    const entra = Math.min(cantidad, TOPE_DE_ETIQUETAS - total);
    if (entra <= 0 || out.length >= TOPE_DE_MEDIDAS) break;
    out.push({ id, cantidad: entra });
    total += entra;
  }
  return out;
}

/** El pedido como va en la URL. */
export function escribirPedidoDeEtiquetas(pedido: PedidoDeEtiqueta[]): string {
  return pedido
    .filter((p) => p.cantidad > 0)
    .map((p) => (p.cantidad === 1 ? p.id : `${p.id}*${p.cantidad}`))
    .join(",");
}

/** Una etiqueta por unidad, en el orden pedido, partidas en hojas. */
export function repartirEnHojas<T extends { variantId: string }>(
  datos: T[],
  pedido: PedidoDeEtiqueta[],
  porHoja: number,
): T[][] {
  const por = new Map(datos.map((d) => [d.variantId, d]));
  const todas: T[] = [];
  for (const p of pedido) {
    const d = por.get(p.id);
    if (!d) continue;
    for (let i = 0; i < p.cantidad; i++) todas.push(d);
  }
  const hojas: T[][] = [];
  for (let i = 0; i < todas.length; i += porHoja) hojas.push(todas.slice(i, i + porHoja));
  return hojas;
}

/** Los tramos de barra de un código: dónde empieza cada uno y cuántos módulos mide. */
export function tramos(modulos: string): { x: number; ancho: number }[] {
  const out: { x: number; ancho: number }[] = [];
  let i = 0;
  while (i < modulos.length) {
    if (modulos[i] !== "1") {
      i++;
      continue;
    }
    let j = i;
    while (j < modulos.length && modulos[j] === "1") j++;
    out.push({ x: i, ancho: j - i });
    i = j;
  }
  return out;
}
