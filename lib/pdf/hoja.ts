import "server-only";

import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFPage,
} from "pdf-lib";

/**
 * Armador de hojas A4.
 *
 * El contrato pide los comprobantes y los remitos "con descarga en PDF"
 * (cláusula 1.6). Imprimir desde el navegador y guardar como PDF no alcanza:
 * hace falta un archivo de verdad para adjuntarlo a un correo, mandarlo por
 * WhatsApp o dárselo al contador.
 *
 * Se genera con `pdf-lib`, que arma el PDF en memoria, sin navegador headless.
 * Un Chromium para imprimir una hoja de texto costaría 300 MB de dependencia y
 * varios segundos por documento.
 *
 * Las fuentes son las estándar de PDF —Helvetica—: están en todo lector y no
 * hay que empaquetar ningún archivo. El precio es que no se puede usar la
 * tipografía de la marca; para un documento fiscal es el intercambio correcto.
 */

/** Milímetros a puntos, que es la unidad de PDF. */
export const mm = (valor: number): number => (valor * 72) / 25.4;

export const A4 = { ancho: mm(210), alto: mm(297) };
export const MARGEN = mm(14);

export const TINTA = rgb(0.1, 0.1, 0.1);
export const TINTA_SUAVE = rgb(0.42, 0.4, 0.38);
export const LINEA = rgb(0.9, 0.88, 0.86);
export const NARANJA = rgb(0.945, 0.416, 0);

export interface Hoja {
  doc: PDFDocument;
  pagina: PDFPage;
  normal: PDFFont;
  negrita: PDFFont;
  mono: PDFFont;
  /** Posición vertical del cursor, desde arriba. */
  y: number;
}

export async function nuevaHoja(): Promise<Hoja> {
  const doc = await PDFDocument.create();
  const pagina = doc.addPage([A4.ancho, A4.alto]);

  return {
    doc,
    pagina,
    normal: await doc.embedFont(StandardFonts.Helvetica),
    negrita: await doc.embedFont(StandardFonts.HelveticaBold),
    mono: await doc.embedFont(StandardFonts.Courier),
    y: A4.alto - MARGEN,
  };
}

/**
 * Limpia el texto de lo que Helvetica no sabe dibujar.
 *
 * Las fuentes estándar de PDF usan WinAnsi, que no tiene ni la comilla
 * tipográfica ni la raya de diálogo ni el guion largo. `pdf-lib` no las
 * reemplaza: lanza una excepción y se cae la descarga entera. Como las
 * descripciones de producto salen tipeadas por gente —y traen comillas de
 * pulgadas, rayas y hasta emoji— hay que normalizar antes de dibujar.
 *
 * Los acentos y la eñe sí están en WinAnsi y se conservan.
 */
export function limpiar(texto: string): string {
  return texto
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”‟]/g, '"')
    .replace(/[–—―]/g, "-")
    .replace(/…/g, "...")
    .replace(/ /g, " ")
    .replace(/[^\x20-\x7E¡-ÿ]/g, "");
}

export interface OpcionesTexto {
  x: number;
  y: number;
  tamano?: number;
  fuente?: PDFFont;
  color?: ReturnType<typeof rgb>;
  /** Alinea a la derecha respecto de `x`. */
  derecha?: boolean;
}

export function escribir(
  hoja: Hoja,
  texto: string,
  opciones: OpcionesTexto,
): void {
  const limpio = limpiar(texto);
  if (!limpio) return;

  const tamano = opciones.tamano ?? 9;
  const fuente = opciones.fuente ?? hoja.normal;
  const ancho = fuente.widthOfTextAtSize(limpio, tamano);

  hoja.pagina.drawText(limpio, {
    x: opciones.derecha ? opciones.x - ancho : opciones.x,
    y: opciones.y,
    size: tamano,
    font: fuente,
    color: opciones.color ?? TINTA,
  });
}

/**
 * Escribe un texto largo cortándolo en varias líneas.
 *
 * Devuelve la altura ocupada, para que quien llama sepa dónde sigue.
 */
export function escribirParrafo(
  hoja: Hoja,
  texto: string,
  opciones: OpcionesTexto & { ancho: number; interlineado?: number },
): number {
  const tamano = opciones.tamano ?? 9;
  const fuente = opciones.fuente ?? hoja.normal;
  const alto = opciones.interlineado ?? tamano * 1.35;

  const palabras = limpiar(texto).split(/\s+/).filter(Boolean);
  const lineas: string[] = [];
  let actual = "";

  for (const palabra of palabras) {
    const tentativa = actual ? `${actual} ${palabra}` : palabra;

    if (fuente.widthOfTextAtSize(tentativa, tamano) > opciones.ancho && actual) {
      lineas.push(actual);
      actual = palabra;
    } else {
      actual = tentativa;
    }
  }

  if (actual) lineas.push(actual);

  lineas.forEach((linea, i) => {
    escribir(hoja, linea, { ...opciones, y: opciones.y - i * alto });
  });

  return lineas.length * alto;
}

/** Escribe centrado respecto de un eje vertical. */
export function escribirCentrado(
  hoja: Hoja,
  texto: string,
  opciones: Omit<OpcionesTexto, "derecha" | "x"> & { centroX: number },
): void {
  const limpio = limpiar(texto);
  if (!limpio) return;

  const tamano = opciones.tamano ?? 9;
  const fuente = opciones.fuente ?? hoja.normal;
  const ancho = fuente.widthOfTextAtSize(limpio, tamano);

  hoja.pagina.drawText(limpio, {
    x: opciones.centroX - ancho / 2,
    y: opciones.y,
    size: tamano,
    font: fuente,
    color: opciones.color ?? TINTA,
  });
}

export function linea(
  hoja: Hoja,
  y: number,
  opciones: { grosor?: number; color?: ReturnType<typeof rgb> } = {},
): void {
  hoja.pagina.drawLine({
    start: { x: MARGEN, y },
    end: { x: A4.ancho - MARGEN, y },
    thickness: opciones.grosor ?? 0.5,
    color: opciones.color ?? LINEA,
  });
}

export function recuadro(
  hoja: Hoja,
  opciones: {
    x: number;
    y: number;
    ancho: number;
    alto: number;
    grosor?: number;
    color?: ReturnType<typeof rgb>;
  },
): void {
  hoja.pagina.drawRectangle({
    x: opciones.x,
    y: opciones.y,
    width: opciones.ancho,
    height: opciones.alto,
    borderWidth: opciones.grosor ?? 1,
    borderColor: opciones.color ?? TINTA,
  });
}

/**
 * Marca de agua en diagonal.
 *
 * La usan los comprobantes sin CAE y los remitos anulados. Va en gris muy
 * claro: tiene que verse sin tapar el texto, porque el documento se sigue
 * usando —solo que sabiendo lo que es—.
 */
export function marcaDeAgua(hoja: Hoja, texto: string): void {
  const tamano = 54;
  const limpio = limpiar(texto.toUpperCase());
  const ancho = hoja.negrita.widthOfTextAtSize(limpio, tamano);

  hoja.pagina.drawText(limpio, {
    x: (A4.ancho - ancho * 0.85) / 2,
    y: A4.alto / 2,
    size: tamano,
    font: hoja.negrita,
    color: rgb(0.85, 0.85, 0.85),
    rotate: { type: "degrees", angle: 32 } as never,
    opacity: 0.55,
  });
}

/** Encabezado común: el emisor arriba a la izquierda. */
export function encabezadoEmisor(
  hoja: Hoja,
  emisor: {
    razonSocial?: string | null;
    nombreFantasia?: string | null;
    domicilio?: string | null;
    cuit?: string | null;
  } | null,
  y: number,
): number {
  let cursor = y;

  escribir(hoja, emisor?.razonSocial || "Maderera Juan B. Justo", {
    x: MARGEN,
    y: cursor,
    tamano: 13,
    fuente: hoja.negrita,
  });
  cursor -= 13;

  if (emisor?.nombreFantasia) {
    escribir(hoja, emisor.nombreFantasia, {
      x: MARGEN,
      y: cursor,
      tamano: 8,
      color: TINTA_SUAVE,
    });
    cursor -= 11;
  }

  for (const dato of [
    emisor?.domicilio,
    emisor?.cuit ? `CUIT ${emisor.cuit}` : null,
  ]) {
    if (!dato) continue;
    escribir(hoja, dato, {
      x: MARGEN,
      y: cursor,
      tamano: 7.5,
      color: TINTA_SUAVE,
    });
    cursor -= 10;
  }

  return cursor;
}

export async function serializar(hoja: Hoja): Promise<Uint8Array> {
  return hoja.doc.save();
}
