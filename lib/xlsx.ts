/**
 * Lector de planillas .xlsx, acotado a lo que esta plataforma necesita.
 *
 * Existe porque el cliente hace dos cosas con Excel: exporta cada grilla del
 * sistema anterior "a Excel" para migrarla, y **actualiza los precios todas
 * las semanas subiendo una planilla**. Hasta ahora las dos cosas chocaban con
 * el mismo mensaje —"esto es un .xlsx, guardalo como CSV UTF-8"—, que para una
 * migración de una vez es un viaje perdido y para una tarea semanal es un paso
 * manual todas las semanas.
 *
 * **Por qué está escrito a mano y no con una librería.** Un .xlsx es un ZIP
 * con XML adentro, y las dos piezas para abrirlo ya estaban en el proyecto:
 * `zlib` viene con Node y `fast-xml-parser` ya se usa para las respuestas de
 * ARCA. Las alternativas de npm son un paquete abandonado en su versión
 * pública o uno de varios megabytes que trae escritura, gráficos y estilos que
 * acá no se usan.
 *
 * **Lo que sí resuelve, porque es donde están los errores de verdad:**
 *
 * - **Las fechas.** Excel las guarda como un número de serie —el 3/9/2026 es
 *   46269— y sin mirar los estilos salen así. En un histórico de veinte mil
 *   ventas, una columna de fechas convertida en números de cinco dígitos no la
 *   descubre nadie hasta que es tarde. Se leen `styles.xml` y los formatos
 *   para saber qué celda es una fecha.
 * - **Las columnas vacías.** Una fila que empieza en la columna C tiene que
 *   entrar con dos campos vacíos adelante, no correrse dos lugares. Por eso se
 *   lee la referencia de cada celda (`C7`) y no el orden de aparición.
 * - **Los textos compartidos.** Excel guarda las cadenas repetidas en una
 *   tabla aparte; una celda con `t="s"` tiene un índice, no el texto.
 *
 * Lo que **no** hace: fórmulas (se lee el último valor calculado, que es lo
 * que se quiere), varias hojas (se lee la primera), y archivos Zip64 de más de
 * 4 GB, que avisa en vez de leer mal.
 */
import { inflateRawSync } from "node:zlib";
import { XMLParser } from "fast-xml-parser";

/** Lo que devuelve el lector: la grilla como texto, igual que el CSV. */
export interface PlanillaLeida {
  filas: string[][];
  /** Nombre de la hoja leída, para poder decirlo en pantalla. */
  hoja: string;
}

/* -------------------------------------------------------------------------- */
/* ZIP                                                                         */
/* -------------------------------------------------------------------------- */

const FIRMA_FIN_CENTRAL = 0x06054b50;
const FIRMA_ENTRADA_CENTRAL = 0x02014b50;

/**
 * Saca los archivos de un ZIP.
 *
 * Se recorre el directorio central y no los encabezados locales: es la única
 * parte del formato que dice con certeza dónde empieza cada archivo. Los
 * encabezados locales pueden traer los tamaños en cero y diferirlos a un
 * descriptor de datos posterior, que es justo lo que hacen los programas que
 * escriben el ZIP mientras lo comprimen.
 */
function abrirZip(bytes: Uint8Array): Map<string, Uint8Array> {
  const vista = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  // El fin del directorio central está al final, después de un comentario de
  // largo variable. Se busca hacia atrás.
  let fin = -1;
  for (let i = bytes.length - 22; i >= 0 && i > bytes.length - 22 - 65535; i--) {
    if (vista.getUint32(i, true) === FIRMA_FIN_CENTRAL) {
      fin = i;
      break;
    }
  }
  if (fin === -1) throw new Error("El archivo no es un .xlsx válido: no se encontró el índice interno.");

  const cantidad = vista.getUint16(fin + 10, true);
  let offset = vista.getUint32(fin + 16, true);

  if (offset === 0xffffffff) {
    throw new Error("El archivo usa el formato Zip64, que no se puede leer. Guardalo de nuevo desde Excel.");
  }

  const archivos = new Map<string, Uint8Array>();

  for (let i = 0; i < cantidad; i++) {
    if (vista.getUint32(offset, true) !== FIRMA_ENTRADA_CENTRAL) break;

    const metodo = vista.getUint16(offset + 10, true);
    const comprimido = vista.getUint32(offset + 20, true);
    const largoNombre = vista.getUint16(offset + 28, true);
    const largoExtra = vista.getUint16(offset + 30, true);
    const largoComentario = vista.getUint16(offset + 32, true);
    const offsetLocal = vista.getUint32(offset + 42, true);

    const nombre = new TextDecoder().decode(
      bytes.subarray(offset + 46, offset + 46 + largoNombre),
    );

    // El encabezado local repite el nombre y el extra, y sus largos pueden no
    // coincidir con los del directorio central. Hay que leerlos de ahí.
    const largoNombreLocal = vista.getUint16(offsetLocal + 26, true);
    const largoExtraLocal = vista.getUint16(offsetLocal + 28, true);
    const inicio = offsetLocal + 30 + largoNombreLocal + largoExtraLocal;

    const crudo = bytes.subarray(inicio, inicio + comprimido);
    archivos.set(nombre, metodo === 0 ? crudo : inflateRawSync(crudo));

    offset += 46 + largoNombre + largoExtra + largoComentario;
  }

  return archivos;
}

/* -------------------------------------------------------------------------- */
/* XML                                                                         */
/* -------------------------------------------------------------------------- */

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  // Todo como texto: un código de artículo "007" no puede volverse 7, y un
  // CUIT de once dígitos no entra sin pérdida en un número de punto flotante.
  parseTagValue: false,
  parseAttributeValue: false,
});

/** Siempre un arreglo, aunque el XML traiga un solo elemento o ninguno. */
function comoLista<T>(valor: T | T[] | undefined): T[] {
  if (valor === undefined) return [];
  return Array.isArray(valor) ? valor : [valor];
}

function leerXml(archivos: Map<string, Uint8Array>, ruta: string): unknown {
  const bytes = archivos.get(ruta);
  if (!bytes) return null;
  return parser.parse(new TextDecoder().decode(bytes));
}

/* -------------------------------------------------------------------------- */
/* Fechas                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Los formatos numéricos que Excel trae de fábrica y que son fechas u horas.
 *
 * Los personalizados se detectan por su patrón, más abajo.
 */
const FORMATOS_FECHA = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);

/**
 * Un número de serie de Excel a fecha ISO.
 *
 * El día 1 es el 1/1/1900, pero Excel cree que 1900 fue bisiesto —un error que
 * arrastra por compatibilidad con Lotus 1-2-3—, así que a partir del 1/3/1900
 * hay que descontar un día. Sin eso, todas las fechas quedan corridas 24 h.
 */
function fechaDeSerie(serie: number): string {
  const dias = Math.floor(serie);
  const ajuste = dias > 59 ? -1 : 0;
  const ms = (dias + ajuste - 25569) * 86400000;
  const fraccion = serie - dias;
  return new Date(ms + Math.round(fraccion * 86400000)).toISOString();
}

/** Qué índices de estilo corresponden a una celda con formato de fecha. */
function estilosDeFecha(archivos: Map<string, Uint8Array>): Set<number> {
  const estilos = new Set<number>();
  const raiz = leerXml(archivos, "xl/styles.xml") as
    | { styleSheet?: Record<string, unknown> }
    | null;
  const hoja = raiz?.styleSheet;
  if (!hoja) return estilos;

  // Formatos personalizados: si el patrón tiene día, mes o año, es una fecha.
  // Se excluye lo que está entre comillas, donde una "d" es una letra suelta.
  const personalizados = new Set<number>();
  const numFmts = (hoja.numFmts as { numFmt?: unknown } | undefined)?.numFmt;
  for (const fmt of comoLista(numFmts) as Record<string, string>[]) {
    const codigo = (fmt["@formatCode"] ?? "").replace(/"[^"]*"/g, "");
    if (/[dmyhs]/i.test(codigo) && /[dy]/i.test(codigo)) {
      personalizados.add(Number(fmt["@numFmtId"]));
    }
  }

  const cellXfs = (hoja.cellXfs as { xf?: unknown } | undefined)?.xf;
  comoLista(cellXfs).forEach((xf, indice) => {
    const id = Number((xf as Record<string, string>)["@numFmtId"] ?? 0);
    if (FORMATOS_FECHA.has(id) || personalizados.has(id)) estilos.add(indice);
  });

  return estilos;
}

/* -------------------------------------------------------------------------- */
/* Hoja                                                                        */
/* -------------------------------------------------------------------------- */

/** "BC12" -> 54 (índice de columna, base cero). */
function columnaDeReferencia(referencia: string): number {
  let columna = 0;
  for (const caracter of referencia) {
    const codigo = caracter.charCodeAt(0);
    if (codigo < 65 || codigo > 90) break;
    columna = columna * 26 + (codigo - 64);
  }
  return columna - 1;
}

/** Los textos compartidos, resueltos a cadenas planas. */
function textosCompartidos(archivos: Map<string, Uint8Array>): string[] {
  const raiz = leerXml(archivos, "xl/sharedStrings.xml") as
    | { sst?: { si?: unknown } }
    | null;

  return comoLista(raiz?.sst?.si).map((si) => {
    const nodo = si as Record<string, unknown>;
    // Texto simple: <si><t>hola</t></si>
    if (typeof nodo.t === "string") return nodo.t;
    if (nodo.t && typeof nodo.t === "object") {
      return String((nodo.t as Record<string, string>)["#text"] ?? "");
    }
    // Texto con formato: <si><r><t>ho</t></r><r><t>la</t></r></si>
    return comoLista(nodo.r)
      .map((r) => {
        const t = (r as Record<string, unknown>).t;
        if (typeof t === "string") return t;
        return String((t as Record<string, string> | undefined)?.["#text"] ?? "");
      })
      .join("");
  });
}

/**
 * Lee la primera hoja de un .xlsx y devuelve la grilla como texto.
 *
 * "Como texto" es deliberado: de acá en adelante el archivo recorre el mismo
 * camino que un CSV —el mismo mapeo de columnas, la misma validación, el mismo
 * `interpretarNumero` que entiende "1.234,56"—. Una segunda ruta con tipos
 * propios sería una segunda ruta donde arreglar cada defecto dos veces.
 */
export function leerXlsx(datos: ArrayBuffer | Uint8Array): PlanillaLeida {
  const bytes = datos instanceof Uint8Array ? datos : new Uint8Array(datos);
  const archivos = abrirZip(bytes);

  const libro = leerXml(archivos, "xl/workbook.xml") as
    | { workbook?: { sheets?: { sheet?: unknown } } }
    | null;
  const primera = comoLista(libro?.workbook?.sheets?.sheet)[0] as
    | Record<string, string>
    | undefined;
  const hoja = primera?.["@name"] ?? "Hoja 1";

  // La ruta de la hoja sale de las relaciones del libro. Se busca la primera
  // que exista, que cubre tanto el nombre habitual como los libros que numeran
  // distinto.
  const rutaHoja =
    [...archivos.keys()]
      .filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))
      .sort()[0] ?? "xl/worksheets/sheet1.xml";

  const datosHoja = leerXml(archivos, rutaHoja) as
    | { worksheet?: { sheetData?: { row?: unknown } } }
    | null;
  if (!datosHoja) {
    throw new Error("El .xlsx no tiene ninguna hoja que se pueda leer.");
  }

  const compartidos = textosCompartidos(archivos);
  const fechas = estilosDeFecha(archivos);

  const filas: string[][] = [];

  for (const filaCruda of comoLista(datosHoja.worksheet?.sheetData?.row)) {
    const nodo = filaCruda as Record<string, unknown>;
    const celdas: string[] = [];

    for (const celdaCruda of comoLista(nodo.c)) {
      const celda = celdaCruda as Record<string, unknown>;
      const referencia = String(celda["@r"] ?? "");
      const indice = referencia ? columnaDeReferencia(referencia) : celdas.length;

      // Los huecos se rellenan: una fila que arranca en C entra con dos
      // campos vacíos adelante y no corrida dos lugares.
      while (celdas.length < indice) celdas.push("");

      celdas[indice] = valorDeCelda(celda, compartidos, fechas);
    }

    filas.push(celdas.map((c) => c ?? ""));
  }

  // Las filas que Excel deja en blanco al final del rango se descartan: son
  // celdas con formato y sin contenido, y entran como filas vacías que la
  // validación después rechaza una por una.
  while (filas.length > 0 && filas[filas.length - 1].every((c) => c === "")) {
    filas.pop();
  }

  return { filas, hoja };
}

function valorDeCelda(
  celda: Record<string, unknown>,
  compartidos: string[],
  fechas: Set<number>,
): string {
  const tipo = String(celda["@t"] ?? "n");

  // Texto escrito dentro de la celda, sin pasar por la tabla compartida.
  if (tipo === "inlineStr") {
    const is = celda.is as Record<string, unknown> | undefined;
    const t = is?.t;
    if (typeof t === "string") return t;
    return String((t as Record<string, string> | undefined)?.["#text"] ?? "");
  }

  const bruto = celda.v;
  const texto =
    typeof bruto === "string"
      ? bruto
      : bruto && typeof bruto === "object"
        ? String((bruto as Record<string, string>)["#text"] ?? "")
        : "";

  if (texto === "") return "";

  // Índice a la tabla de textos compartidos.
  if (tipo === "s") return compartidos[Number(texto)] ?? "";

  // Booleano: Excel guarda 0 y 1.
  if (tipo === "b") return texto === "1" ? "VERDADERO" : "FALSO";

  // Error de fórmula (#N/A, #DIV/0!): entra tal cual para que se vea.
  if (tipo === "e") return texto;

  const estilo = Number(celda["@s"] ?? -1);
  if (fechas.has(estilo)) {
    const serie = Number(texto);
    // Una celda con formato de fecha puede tener texto adentro; solo se
    // convierte lo que de verdad es un número de serie.
    if (Number.isFinite(serie) && serie > 0) return fechaDeSerie(serie);
  }

  return texto;
}
