import { formatearCantidad, formatearUnidadLarga, formatearUnidadPlural, admiteDecimales } from "@/lib/unidades";

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
 * Lee lo que se tipeó en la cantidad de la consulta (corrección de T5).
 *
 * No es `leerCantidad` del panel: acá escribe un cliente, y quien pide
 * machimbre escribe «1.500» queriendo decir mil quinientos. Punto seguido de
 * grupos de tres dígitos es separador de miles; la coma es decimal; un punto
 * con otra cantidad de dígitos («3.75») es decimal, porque así lo escribe el
 * teclado del celular. La unidad escrita al final («10 placas», «20 m²») se
 * ignora: el campo ya la dice.
 */
export function leerCantidadDeConsulta(tipeado: string): number {
  const sinUnidad = tipeado.trim().replace(/\s*[a-záéíóúñ²]+\.?$/i, "");
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(sinUnidad)) {
    return Number(sinUnidad.replace(/\./g, "").replace(",", "."));
  }
  const limpio = sinUnidad.replace(",", ".");
  return /^\d+(\.\d+)?$/.test(limpio) ? Number(limpio) : NaN;
}

/**
 * La cantidad tipeada, lista para el texto, o `null` si no sirve.
 *
 * Vacío, cero, negativo o algo que no es número: `null`, y el texto sale sin
 * cantidad, como antes. Lo que se cuenta (placas, tablas, unidades) tiene
 * que ser entero: «2,5» placas **no se redondea** a 3 en silencio, sale sin
 * cantidad y el campo se marca (`cantidadInvalida`). La media placa se elige
 * aparte («Cómo la querés»), y entonces lo que se cuenta son medias. Lo que
 * se mide (metros, m²) admite decimales. Arriba de 9999 se topea.
 */
export function cantidadDeConsulta(tipeado: string, unidad: string): number | null {
  const n = leerCantidadDeConsulta(tipeado);
  if (!Number.isFinite(n) || n <= 0) return null;
  const entera = !admiteDecimales(unidad) || unidad === "placa";
  if (entera && !Number.isInteger(n)) return null;
  const redondeada = entera ? n : Math.round(n * 100) / 100;
  if (redondeada <= 0) return null;
  return Math.min(redondeada, TOPE_DE_CANTIDAD);
}

/** Si lo tipeado no sirve y hay que marcar el campo: escribió algo y no hay cantidad. */
export function cantidadInvalida(tipeado: string, unidad: string): boolean {
  return tipeado.trim() !== "" && cantidadDeConsulta(tipeado, unidad) === null;
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
  // Con media placa, la cantidad cuenta medias y el texto lo dice: «12
  // placas … (media placa, al largo)» no decía si eran 12 enteras cortadas o
  // 12 medias, y el vendedor cotizaba el doble o la mitad.
  const media = como && /^media placa/i.test(como) ? como.replace(/^media placa,?\s*/i, "") : null;
  const cuanto = !cantidad
    ? ""
    : media !== null
      ? `${formatearCantidad(cantidad)} ${cantidad === 1 ? "media placa" : "medias placas"} de `
      : `${cantidadConUnidad(cantidad, unidad)} de `;
  const forma = media !== null && cantidad ? (media ? ` (${media})` : "") : como ? ` (${como})` : "";
  const cod = codigo ? ` [${codigo}]` : "";
  return `Hola! Quería el precio de ${cuanto}${producto} — ${medida}${forma}${cod}. ¿Tienen disponible?`;
}

/** El enlace de wa.me con el texto codificado entero: «×», «—», «ñ» y «²» incluidos. */
export function enlaceDeConsulta(numero: string, texto: string): string {
  return `https://wa.me/${numero.replace(/\D/g, "")}?text=${encodeURIComponent(texto)}`;
}
