/**
 * Planilla de precios: generación y lectura.
 *
 * El formato es CSV y no .xlsx a propósito. Excel abre y guarda CSV sin
 * plugins, el archivo se puede revisar con cualquier cosa, y evita meter una
 * dependencia de lectura de binarios en el camino de subida de archivos.
 *
 * A cambio hay que manejar tres particularidades de Excel en español, que son
 * justo las que hacen que un CSV "no funcione" en la vida real:
 *
 *  1. Separador `;`. Con configuración regional en español, Excel usa punto y
 *     coma, no coma. Al leer aceptamos los dos.
 *  2. Coma decimal. "1234,56" es lo que escribe alguien acá; también aceptamos
 *     punto y separadores de miles.
 *  3. BOM UTF-8. Sin él, Excel abre el archivo en Latin-1 y las tildes y las
 *     eñes salen rotas.
 */

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

/** Divide una línea respetando las comillas que pone Excel. */
function partirLinea(linea: string, separador: string): string[] {
  const campos: string[] = [];
  let actual = "";
  let entreComillas = false;

  for (let i = 0; i < linea.length; i++) {
    const caracter = linea[i];

    if (caracter === '"') {
      if (entreComillas && linea[i + 1] === '"') {
        actual += '"';
        i++;
      } else {
        entreComillas = !entreComillas;
      }
      continue;
    }

    if (caracter === separador && !entreComillas) {
      campos.push(actual);
      actual = "";
      continue;
    }

    actual += caracter;
  }

  campos.push(actual);
  return campos.map((c) => c.trim());
}

/**
 * Convierte lo que se escribió en la celda a un número.
 *
 * Acepta "12.345,67", "12345.67", "$ 12.345", "12345" y vacío. Devuelve null si
 * no se puede interpretar, para poder marcar la fila en la vista previa en vez
 * de guardar un precio equivocado.
 */
export function interpretarPrecio(bruto: string): string | null {
  const limpio = (bruto ?? "").replace(/[^\d.,-]/g, "").trim();
  if (limpio === "") return null;

  const tieneComa = limpio.includes(",");
  const tienePunto = limpio.includes(".");

  let normalizado = limpio;

  if (tieneComa && tienePunto) {
    // El último separador que aparece es el decimal.
    normalizado =
      limpio.lastIndexOf(",") > limpio.lastIndexOf(".")
        ? limpio.replace(/\./g, "").replace(",", ".")
        : limpio.replace(/,/g, "");
  } else if (tieneComa) {
    const [, decimales = ""] = limpio.split(",");
    // "1,234" con tres cifras detrás es separador de miles, no una fracción.
    normalizado =
      decimales.length === 3
        ? limpio.replace(/,/g, "")
        : limpio.replace(",", ".");
  } else if (tienePunto) {
    // Mismo criterio para el punto: acá "96.500" son noventa y seis mil
    // quinientos, no noventa y seis con cincuenta. Es la forma habitual de
    // escribir un precio, así que confundirla dividiría el valor por mil.
    const decimales = limpio.slice(limpio.lastIndexOf(".") + 1);
    normalizado =
      decimales.length === 3 ? limpio.replace(/\./g, "") : limpio;
  }

  const numero = Number(normalizado);
  if (!Number.isFinite(numero) || numero < 0) return null;

  return numero.toFixed(2);
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

  // El separador se deduce del encabezado: Excel escribe uno u otro según cómo
  // esté configurada la computadora donde se guardó.
  const encabezado = lineas[0];
  const separador =
    (encabezado.match(/;/g)?.length ?? 0) >=
    (encabezado.match(/,/g)?.length ?? 0)
      ? ";"
      : ",";

  const columnas = partirLinea(encabezado, separador).map((c) =>
    c.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, ""),
  );

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
