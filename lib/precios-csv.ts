/**
 * Planilla de precios: generación y lectura.
 *
 * El formato es CSV y no .xlsx a propósito. Excel abre y guarda CSV sin
 * plugins, el archivo se puede revisar con cualquier cosa, y evita meter una
 * dependencia de lectura de binarios en el camino de subida de archivos.
 *
 * Las particularidades de Excel en español —separador `;`, coma decimal, BOM
 * UTF-8 y comillas— las resuelve `lib/csv.ts`, que es el mismo lector que usa
 * la migración desde el sistema anterior.
 */

import {
  detectarSeparador,
  interpretarNumero,
  normalizarEncabezado,
  partirLinea,
} from "./csv";

export const COLUMNAS = [
  "SKU",
  "Producto",
  "Medida",
  "Categoria",
  "Precio lista",
  "Precio profesional",
] as const;

export interface FilaPlanilla {
  sku: string;
  producto: string;
  medida: string;
  categoria: string;
  precioGeneral: string;
  precioProfesional: string;
}

const BOM = "﻿";
const SEPARADOR = ";";

function escapar(valor: string): string {
  const texto = valor ?? "";
  return /[";\n]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
}

/** Arma la planilla para descargar. Los precios van con coma decimal. */
export function generarCsv(filas: FilaPlanilla[]): string {
  const lineas = [COLUMNAS.join(SEPARADOR)];

  for (const fila of filas) {
    lineas.push(
      [
        fila.sku,
        fila.producto,
        fila.medida,
        fila.categoria,
        fila.precioGeneral.replace(".", ","),
        fila.precioProfesional.replace(".", ","),
      ]
        .map(escapar)
        .join(SEPARADOR),
    );
  }

  return BOM + lineas.join("\r\n") + "\r\n";
}

/**
 * Precio leído de una celda. Un precio negativo no existe: si aparece uno, es
 * una columna mal mapeada o un signo de más que se coló, y vale más marcar la
 * fila que guardarlo.
 */
export function interpretarPrecio(bruto: string): string | null {
  const numero = interpretarNumero(bruto);
  if (numero === null || Number(numero) < 0) return null;
  return numero;
}

export interface FilaImportada {
  linea: number;
  sku: string;
  precioGeneral: string | null;
  precioProfesional: string | null;
  error?: string;
}

/** Lee la planilla subida y devuelve una fila por línea, con sus errores. */
export function leerCsv(contenido: string): FilaImportada[] {
  const texto = contenido.replace(/^﻿/, "");
  const lineas = texto
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lineas.length === 0) return [];

  const encabezado = lineas[0];
  const separador = detectarSeparador(encabezado);
  const columnas = partirLinea(encabezado, separador).map(normalizarEncabezado);

  const iSku = columnas.findIndex((c) => c.includes("sku"));
  const iGeneral = columnas.findIndex(
    (c) => c.includes("lista") || c === "precio",
  );
  const iProfesional = columnas.findIndex((c) => c.includes("profesional"));

  if (iSku === -1) {
    return [
      {
        linea: 1,
        sku: "",
        precioGeneral: null,
        precioProfesional: null,
        error: "La planilla no tiene una columna SKU.",
      },
    ];
  }

  return lineas.slice(1).map((linea, i) => {
    const campos = partirLinea(linea, separador);
    const sku = (campos[iSku] ?? "").trim();

    if (!sku) {
      return {
        linea: i + 2,
        sku: "",
        precioGeneral: null,
        precioProfesional: null,
        error: "Falta el SKU.",
      };
    }

    const general =
      iGeneral >= 0 ? interpretarPrecio(campos[iGeneral] ?? "") : null;
    const profesional =
      iProfesional >= 0 ? interpretarPrecio(campos[iProfesional] ?? "") : null;

    if (general === null && profesional === null) {
      return {
        linea: i + 2,
        sku,
        precioGeneral: null,
        precioProfesional: null,
        error: "No se pudo leer ningún precio de esta fila.",
      };
    }

    return {
      linea: i + 2,
      sku,
      precioGeneral: general,
      precioProfesional: profesional,
    };
  });
}
