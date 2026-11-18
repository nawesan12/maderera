import { formatearCantidad, formatearUnidadLarga, formatearUnidadPlural, leerCantidad, admiteDecimales } from "@/lib/unidades";

/**
 * El texto que la ficha manda por WhatsApp cuando no hay precio (hallazgo 45
 * del comité, 18/11/2026).
 *
 * Quien atiende contesta el precio sin preguntar nada de vuelta: va el
 * producto, la medida, cómo la quiere (media placa), cuántas y el código. La
 * cantidad faltaba, y es lo primero que pregunta el vendedor: el precio de 1
 * placa y el de 40 no son el mismo mensaje.
 */

/** Lo más que se acepta en el campo: más que esto es un error de tipeo. */
export const TOPE_DE_CANTIDAD = 9999;

/**
 * La cantidad tipeada, lista para el texto, o `null` si no sirve.
 *
 * Vacío, cero, negativo o algo que no es número: `null`, y el texto sale sin
 * cantidad, como antes. Lo que se cuenta (placas, tablas, unidades) se
 * redondea a entero; lo que se mide (metros, m²) admite decimales. Arriba de
 * 9999 se topea.
 */
export function cantidadDeConsulta(tipeado: string, unidad: string): number | null {
  const n = leerCantidad(tipeado);
  if (!Number.isFinite(n) || n <= 0) return null;
  // La placa admite media en el panel, pero acá «media» se elige aparte
  // («Cómo la querés»): la cantidad es de placas enteras o de medias.
  const entera = !admiteDecimales(unidad) || unidad === "placa";
  const redondeada = entera ? Math.round(n) : Math.round(n * 100) / 100;
  if (redondeada <= 0) return null;
  return Math.min(redondeada, TOPE_DE_CANTIDAD);
}

/** «12 placas», «1 placa», «2,5 metros cuadrados». */
export function cantidadConUnidad(cantidad: number, unidad: string): string {
  const nombre = cantidad === 1 ? formatearUnidadLarga(unidad) : formatearUnidadPlural(unidad);
  return `${formatearCantidad(cantidad)} ${nombre}`;
}

export function textoDeConsulta({
  producto,
  medida,
  como,
  cantidad,
  unidad,
  codigo,
}: {
  producto: string;
  medida: string;
  /** «media placa, al largo», o `null` si es entera. */
  como?: string | null;
  cantidad?: number | null;
  unidad: string;
  /** El código de la medida: el vendedor lo busca así en el sistema. */
  codigo?: string | null;
}): string {
  const cuanto = cantidad ? `${cantidadConUnidad(cantidad, unidad)} de ` : "";
  const forma = como ? ` (${como})` : "";
  const cod = codigo ? ` [${codigo}]` : "";
  return `Hola! Quería el precio de ${cuanto}${producto} — ${medida}${forma}${cod}. ¿Tienen disponible?`;
}

/** El enlace de wa.me con el texto codificado entero: «×», «—», «ñ» y «²» incluidos. */
export function enlaceDeConsulta(numero: string, texto: string): string {
  return `https://wa.me/${numero.replace(/\D/g, "")}?text=${encodeURIComponent(texto)}`;
}
