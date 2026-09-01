/**
 * Armado del archivo que se le da al optimizador de la seccionadora.
 *
 * El taller no corta desde este sistema: corta desde el software que vino con
 * la máquina —Cut Rite, Ardis, Corte Certo, Optimik, o el propio del
 * fabricante—, y ese software es el que arma el patrón de corte. Lo que hace
 * falta es entregarle la **lista de piezas** en un formato que sepa importar,
 * para que nadie tenga que volver a tipear treinta medidas que ya están
 * cargadas acá.
 *
 * **Por qué es configurable y no un formato fijo.** Todavía no vimos un archivo
 * real del taller: no sabemos qué programa usan, ni qué versión, ni qué
 * columnas espera. Escribir "el formato de Cut Rite" de memoria sería inventar
 * un dato que después falla en la visita. Así que se hace lo mismo que con la
 * migración desde el sistema anterior: el mecanismo se construye entero y
 * probado, y el mapeo concreto se define en pantalla cuando el archivo esté.
 *
 * Es lógica pura, sin base ni servidor, para poder probarla.
 */

/** Cada columna que se puede poner en el archivo, y de dónde sale. */
export type ClaveColumna =
  | "largo"
  | "ancho"
  | "cantidad"
  | "material"
  | "etiqueta"
  | "veta"
  | "cantoLargo"
  | "cantoAncho"
  | "numero"
  | "cliente";

export const COLUMNAS: Record<ClaveColumna, string> = {
  largo: "Largo",
  ancho: "Ancho",
  cantidad: "Cantidad",
  material: "Material",
  etiqueta: "Etiqueta",
  veta: "Respeta veta",
  cantoLargo: "Canto largo",
  cantoAncho: "Canto ancho",
  numero: "N° de corte",
  cliente: "Cliente",
};

export interface ColumnaConfigurada {
  clave: ClaveColumna;
  /** Cómo se llama la columna en el archivo. Lo decide el otro programa. */
  encabezado: string;
}

export interface PerfilDeExportacion {
  nombre: string;
  /** `;` abre en Excel en castellano; `\t` lo piden varios importadores. */
  separador: string;
  /** Muchos importadores no esperan encabezado y toman la primera fila como pieza. */
  conEncabezado: boolean;
  /** Las medidas se guardan en milímetros; algunos programas quieren cm o m. */
  unidad: "mm" | "cm" | "m";
  /** Coma o punto. En Argentina es coma, pero el importador manda. */
  decimal: "," | ".";
  /** Cómo se dicen "sí" y "no" en las columnas de veta y cantos. */
  siNo: [string, string];
  /** Fin de línea. Los programas de Windows viejos quieren CRLF. */
  finDeLinea: "\n" | "\r\n";
  columnas: ColumnaConfigurada[];
}

/**
 * El punto de partida: un CSV que abre en Excel y que casi cualquier
 * importador acepta con un mapeo manual de columnas.
 *
 * No dice ser "el formato" de ningún programa en particular, porque no lo
 * sabemos todavía. Es el mínimo común denominador, y se ajusta en pantalla en
 * cuanto haya un archivo del taller con el que comparar.
 */
export const PERFIL_GENERICO: PerfilDeExportacion = {
  nombre: "Genérico (CSV)",
  separador: ";",
  conEncabezado: true,
  unidad: "mm",
  decimal: ",",
  siNo: ["Sí", "No"],
  finDeLinea: "\r\n",
  columnas: [
    { clave: "largo", encabezado: "Largo" },
    { clave: "ancho", encabezado: "Ancho" },
    { clave: "cantidad", encabezado: "Cantidad" },
    { clave: "material", encabezado: "Material" },
    { clave: "etiqueta", encabezado: "Etiqueta" },
    { clave: "veta", encabezado: "Veta" },
    { clave: "cantoLargo", encabezado: "Canto largo" },
    { clave: "cantoAncho", encabezado: "Canto ancho" },
  ],
};

export interface PiezaParaExportar {
  largoMm: number;
  anchoMm: number;
  cantidad: number;
  respetaVeta: number;
  cantoLargo: number;
  cantoAncho: number;
  etiqueta: string | null;
}

export interface CorteParaExportar {
  numero: string;
  cliente: string;
  material: string;
  piezas: PiezaParaExportar[];
}

/**
 * Convierte de milímetros a la unidad del perfil.
 *
 * Se hace con enteros y se corta el sobrante en lugar de dividir en punto
 * flotante: `123 / 10` da `12.3` pero `1229 / 10` da `122.89999999999999`, y un
 * optimizador que lee eso corta una pieza con una décima de menos.
 */
export function convertirMedida(
  mm: number,
  unidad: PerfilDeExportacion["unidad"],
  decimal: "," | ".",
): string {
  if (unidad === "mm") return String(Math.round(mm));

  const divisor = unidad === "cm" ? 10 : 1000;
  const entero = Math.trunc(mm / divisor);
  const resto = Math.abs(mm % divisor);
  const decimales = String(resto).padStart(unidad === "cm" ? 1 : 3, "0");

  return `${entero}${decimal}${decimales}`;
}

/**
 * Escapa un valor de texto para CSV.
 *
 * Un material escrito como "Melamina 18mm; blanco" parte la fila en dos si el
 * separador es `;`. Pasa en el mostrador y no es un caso raro.
 */
function escapar(valor: string, separador: string): string {
  const necesita =
    valor.includes(separador) ||
    valor.includes('"') ||
    valor.includes("\n") ||
    valor.includes("\r");

  return necesita ? `"${valor.replace(/"/g, '""')}"` : valor;
}

/** El archivo entero, listo para descargar. */
export function armarArchivoDeCorte(
  corte: CorteParaExportar,
  perfil: PerfilDeExportacion,
): string {
  const si = perfil.siNo[0];
  const no = perfil.siNo[1];

  const valorDe = (
    pieza: PiezaParaExportar,
    clave: ClaveColumna,
  ): string => {
    switch (clave) {
      case "largo":
        return convertirMedida(pieza.largoMm, perfil.unidad, perfil.decimal);
      case "ancho":
        return convertirMedida(pieza.anchoMm, perfil.unidad, perfil.decimal);
      case "cantidad":
        return String(pieza.cantidad);
      case "material":
        return corte.material;
      case "etiqueta":
        return pieza.etiqueta ?? "";
      case "veta":
        return pieza.respetaVeta === 1 ? si : no;
      case "cantoLargo":
        return pieza.cantoLargo === 1 ? si : no;
      case "cantoAncho":
        return pieza.cantoAncho === 1 ? si : no;
      case "numero":
        return corte.numero;
      case "cliente":
        return corte.cliente;
    }
  };

  const filas: string[] = [];

  if (perfil.conEncabezado) {
    filas.push(
      perfil.columnas
        .map((c) => escapar(c.encabezado, perfil.separador))
        .join(perfil.separador),
    );
  }

  for (const pieza of corte.piezas) {
    filas.push(
      perfil.columnas
        .map((c) => escapar(valorDe(pieza, c.clave), perfil.separador))
        .join(perfil.separador),
    );
  }

  return filas.join(perfil.finDeLinea) + perfil.finDeLinea;
}

/** Nombre de archivo previsible: el operador va a tener varios en la carpeta. */
export function nombreDeArchivo(numero: string, separador: string): string {
  // Los repetidos se colapsan: "../C 1042" da "_C_1042" y no "___C_1042".
  const limpio = numero
    .replace(/[^A-Za-z0-9-]+/g, "_")
    .replace(/^_|_$/g, "");
  return `${limpio}.${separador === "\t" ? "txt" : "csv"}`;
}
