/**
 * Lectura de planillas CSV.
 *
 * Lo comparten la importación de precios y la migración desde el sistema
 * anterior: son dos versiones del mismo problema, un archivo que salió de una
 * computadora ajena y con la configuración regional de esa computadora.
 *
 * Tres particularidades son las que hacen que un CSV "no funcione" en la vida
 * real, y las tres se resuelven acá:
 *
 *  1. **Separador `;`.** Con configuración regional en español, Excel escribe
 *     punto y coma, no coma. Se deduce del encabezado en vez de imponerlo.
 *  2. **Codificación.** Los sistemas de escritorio viejos guardan en
 *     Windows-1252, no en UTF-8: leído como UTF-8, "Cañuelas" sale roto o
 *     directamente rompe. Se prueba UTF-8 estricto y se cae a Windows-1252.
 *  3. **Saltos de línea dentro de comillas.** Un domicilio de dos renglones
 *     parte el archivo en dos si se lee línea por línea, y a partir de ahí
 *     todas las columnas quedan corridas. Por eso el recorrido es carácter por
 *     carácter y no `split("\n")`.
 */

/** El BOM que Excel escribe adelante para no perder las tildes. */
const BOM = /^\ufeff/;

const SEPARADORES = [";", "\t", ","] as const;

/**
 * Reconoce los archivos que no son texto antes de intentar leerlos.
 *
 * El sistema del que se migra —ISIS ERP Manager— exporta cada grilla "a
 * Excel", así que lo más probable es que alguien suba un .xlsx o un .xls
 * directamente. Decodificar eso como texto produce una pantalla de símbolos y
 * un mensaje inútil; conviene mirar los primeros bytes y decir qué pasó.
 */
export function formatoBinario(
  datos: ArrayBuffer | Uint8Array,
): "xlsx" | "xls" | "pdf" | null {
  const bytes = datos instanceof Uint8Array ? datos : new Uint8Array(datos);
  const firma = Array.from(bytes.slice(0, 8));

  // "PK": un .xlsx es un ZIP con XML adentro.
  if (firma[0] === 0x50 && firma[1] === 0x4b) return "xlsx";

  // Documento compuesto de Office: el .xls de toda la vida.
  const ole = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
  if (ole.every((byte, i) => firma[i] === byte)) return "xls";

  // "%PDF"
  if (firma[0] === 0x25 && firma[1] === 0x50 && firma[2] === 0x44 && firma[3] === 0x46) {
    return "pdf";
  }

  return null;
}

/**
 * Convierte los bytes del archivo a texto.
 *
 * UTF-8 primero y en modo estricto: si el archivo no es UTF-8 válido queremos
 * enterarnos con una excepción, no con un texto lleno de rombos que después se
 * guarda así en la base.
 */
export function decodificarPlanilla(datos: ArrayBuffer | Uint8Array): {
  texto: string;
  codificacion: "utf-8" | "windows-1252";
} {
  const bytes = datos instanceof Uint8Array ? datos : new Uint8Array(datos);

  try {
    const texto = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return { texto: texto.replace(BOM, ""), codificacion: "utf-8" };
  } catch {
    const texto = new TextDecoder("windows-1252").decode(bytes);
    return { texto: texto.replace(BOM, ""), codificacion: "windows-1252" };
  }
}

/**
 * Deduce el separador contando cuál aparece más en el encabezado.
 *
 * Se mira solo la primera línea porque es la que menos datos tiene: una fila
 * con un domicilio "San Martín 1234, Mar del Plata" está llena de comas que no
 * separan nada.
 */
export function detectarSeparador(texto: string): string {
  const encabezado = texto.replace(BOM, "").split(/\r?\n/, 1)[0] ?? "";

  let elegido = ";";
  let mayor = 0;

  for (const separador of SEPARADORES) {
    const cuantos = encabezado.split(separador).length - 1;
    if (cuantos > mayor) {
      mayor = cuantos;
      elegido = separador;
    }
  }

  return elegido;
}

/**
 * Parte el archivo entero en filas y campos.
 *
 * Devuelve las filas ya recortadas y sin las que quedaron completamente
 * vacías: una planilla de Excel casi siempre termina con renglones en blanco
 * que no son registros.
 */
export function partirPlanilla(texto: string, separador: string): string[][] {
  const contenido = texto.replace(BOM, "").replace(/\r\n?/g, "\n");

  const filas: string[][] = [];
  let campos: string[] = [];
  let actual = "";
  let entreComillas = false;

  const cerrarCampo = () => {
    campos.push(actual.trim());
    actual = "";
  };

  const cerrarFila = () => {
    cerrarCampo();
    if (campos.some((campo) => campo !== "")) filas.push(campos);
    campos = [];
  };

  for (let i = 0; i < contenido.length; i++) {
    const caracter = contenido[i];

    if (entreComillas) {
      if (caracter === '"') {
        // Dos comillas seguidas son una comilla del dato, no el cierre.
        if (contenido[i + 1] === '"') {
          actual += '"';
          i++;
        } else {
          entreComillas = false;
        }
        continue;
      }
      actual += caracter;
      continue;
    }

    // La comilla solo delimita si abre el campo. En el medio es un dato, y en
    // una maderera es el dato más común que hay: 2" x 4" x 3.60m. Tratarla
    // siempre como delimitador borra la pulgada de todas las medidas.
    if (caracter === '"' && actual.trim() === "") {
      actual = "";
      entreComillas = true;
      continue;
    }
    if (caracter === separador) {
      cerrarCampo();
      continue;
    }
    if (caracter === "\n") {
      cerrarFila();
      continue;
    }

    actual += caracter;
  }

  if (actual !== "" || campos.length > 0) cerrarFila();

  return filas;
}

/** Parte una sola línea. Atajo para quien ya viene iterando por renglón. */
export function partirLinea(linea: string, separador: string): string[] {
  return partirPlanilla(linea, separador)[0] ?? [];
}

/**
 * Deja un nombre de columna en su forma comparable: sin tildes, sin espacios,
 * sin puntuación y en minúsculas. "Razón Social" y "razon_social" son la misma
 * columna y el mapeo automático tiene que poder verlo.
 */
export function normalizarEncabezado(texto: string): string {
  return (texto ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

/**
 * Convierte lo que se escribió en la celda a un número, respetando el signo.
 *
 * Acepta "12.345,67", "12345.67", "$ 12.345", "12345" y "(1.500,00)" —la
 * contabilidad escribe los negativos entre paréntesis, y en un saldo de cuenta
 * corriente el signo es justamente lo que decide quién le debe a quién—.
 * Devuelve null cuando no se puede interpretar, para poder marcar la fila en
 * vez de guardar un número equivocado.
 */
export function interpretarNumero(bruto: string): string | null {
  const texto = (bruto ?? "").trim();
  if (texto === "") return null;

  const entreParentesis = /^\(.*\)$/.test(texto);
  const limpio = texto.replace(/[^\d.,-]/g, "").trim();
  if (limpio === "" || limpio === "-") return null;

  const negativo = entreParentesis || limpio.startsWith("-");
  const cuerpo = negativo ? limpio.replace(/^-/, "") : limpio;
  // Un guion en el medio no es un signo: es un dato que no es un número.
  if (cuerpo.includes("-")) return null;

  const tieneComa = cuerpo.includes(",");
  const tienePunto = cuerpo.includes(".");

  let normalizado = cuerpo;

  if (tieneComa && tienePunto) {
    // El último separador que aparece es el decimal.
    normalizado =
      cuerpo.lastIndexOf(",") > cuerpo.lastIndexOf(".")
        ? cuerpo.replace(/\./g, "").replace(",", ".")
        : cuerpo.replace(/,/g, "");
  } else if (tieneComa) {
    const [, decimales = ""] = cuerpo.split(",");
    // "1,234" con tres cifras detrás es separador de miles, no una fracción.
    normalizado =
      decimales.length === 3
        ? cuerpo.replace(/,/g, "")
        : cuerpo.replace(",", ".");
  } else if (tienePunto) {
    // Mismo criterio para el punto: acá "96.500" son noventa y seis mil
    // quinientos, no noventa y seis con cincuenta. Es la forma habitual de
    // escribir un precio, así que confundirla dividiría el valor por mil.
    const decimales = cuerpo.slice(cuerpo.lastIndexOf(".") + 1);
    normalizado = decimales.length === 3 ? cuerpo.replace(/\./g, "") : cuerpo;
  }

  const numero = Number(normalizado);
  if (!Number.isFinite(numero)) return null;

  return (negativo ? -numero : numero).toFixed(2);
}
