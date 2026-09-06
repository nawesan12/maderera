/**
 * Planilla de precios: generación y lectura.
 *
 * **Lo que se descarga es un CSV; lo que se sube puede ser CSV o .xlsx.** La
 * asimetría es a propósito: el archivo que generamos conviene que sea texto
 * —se revisa con cualquier cosa y no depende de Excel—, pero el que sube el
 * cliente es el que él tenga. Los precios se actualizan todas las semanas, y
 * pedir "guardalo como CSV UTF-8" cincuenta veces por año es un paso manual
 * que se termina saltando.
 *
 * Este módulo ya no lee el archivo: recibe la grilla ya partida. De eso se
 * encarga `lib/planilla.ts`, que es el mismo camino por el que entra la
 * migración —mismo manejo de separador, comillas, Windows-1252 y coma
 * decimal—. Antes había acá una segunda copia que partía por renglones, y por
 * eso arrastraba el defecto que la migración ya había corregido: un campo
 * entre comillas con un salto de línea adentro partía el registro en dos.
 */

import { interpretarNumero, normalizarEncabezado } from "./csv";

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

/** Lee la planilla ya partida y devuelve una fila por renglón, con sus errores. */
export function leerFilas(grilla: string[][]): FilaImportada[] {
  const lineas = grilla.filter((fila) => fila.some((c) => c.trim() !== ""));

  if (lineas.length === 0) return [];

  const columnas = lineas[0].map(normalizarEncabezado);

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

  return lineas.slice(1).map((campos, i) => {
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
