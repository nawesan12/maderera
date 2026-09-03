/**
 * CSV para Excel en español.
 *
 * Tres decisiones que parecen manías y no lo son. **Punto y coma como
 * separador**, porque con coma un importe como "1.234,56" parte la columna en
 * dos y hay que rearmar el archivo a mano. **Coma decimal**, porque es lo que
 * Excel en español entiende como número; con punto lo toma como texto y no lo
 * puede sumar. Y el **BOM adelante**, sin el cual "Melamínica" llega como
 * "MelamÃ­nica".
 *
 * Vive acá porque ya se copió dos veces —el libro IVA y los reportes— y está a
 * punto de copiarse tres más: libro IVA compras, retenciones y asientos.
 */

/** Un importe, con coma decimal. */
export function numeroCsv(valor: number, decimales = 2): string {
  return valor.toFixed(decimales).replace(".", ",");
}

/** Un entero, sin decimales: las cantidades no llevan ",00". */
export function enteroCsv(valor: number): string {
  return String(Math.round(valor));
}

/** Texto entrecomillado, con las comillas internas escapadas. */
export function textoCsv(valor: string | null | undefined): string {
  return `"${(valor ?? "").replace(/"/g, '""')}"`;
}

/** Una fecha como la lee Excel en español. */
export function fechaCsv(valor: Date | null | undefined): string {
  if (!valor) return "";
  const dia = String(valor.getDate()).padStart(2, "0");
  const mes = String(valor.getMonth() + 1).padStart(2, "0");
  return `${dia}/${mes}/${valor.getFullYear()}`;
}

/**
 * Arma el archivo entero.
 *
 * Las filas ya vienen formateadas: esta función no sabe qué es un importe y qué
 * es un texto, solo pega. `\r\n` porque es lo que espera Excel en Windows, que
 * es donde se abren estas planillas.
 */
export function armarCsv(
  encabezados: string[],
  filas: string[][],
  totales?: string[],
): string {
  const lineas = [
    encabezados.map(textoCsv).join(";"),
    ...filas.map((f) => f.join(";")),
  ];

  if (totales) lineas.push(totales.join(";"));

  return `﻿${lineas.join("\r\n")}\r\n`;
}

/** Las cabeceras de la respuesta, con el nombre del archivo. */
export function cabecerasCsv(nombre: string): HeadersInit {
  return {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="${nombre}"`,
    "Cache-Control": "private, no-store",
  };
}
