/**
 * Golden de la lectura de planillas (lib/csv.ts, lib/xlsx.ts, lib/planilla.ts
 * y lib/precios-csv.ts). El Go (internal/planilla) tiene que dar lo mismo,
 * byte a byte.
 *
 * Arma archivos de verdad —CSV en UTF-8 y en Windows-1252, .xlsx escritos a
 * mano (el ZIP y el XML), un .xls y un PDF— en
 * backend/testdata/golden/planilla/archivos/, y guarda lo que el TS devuelve
 * para cada uno con leerPlanilla y leerFilas. Además, casos sueltos de
 * interpretarNumero, normalizarEncabezado, detectarSeparador, partirPlanilla
 * y generarCsv, y variantes al azar (con semilla fija) de CSV, XML, ZIP y
 * deflate para encontrar lo que los casos escritos a mano no ven.
 *
 *   npx tsx scripts/golden/planilla.ts
 */
import { createRequire } from "node:module";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { crc32, deflateRawSync, gzipSync, inflateRawSync } from "node:zlib";

// lib/planilla.ts importa "server-only", que fuera de Next tira un error: se
// lo reemplaza por un módulo vacío antes de importarlo.
const requerir = createRequire(import.meta.url);
const rutaServerOnly = requerir.resolve("server-only");
requerir.cache[rutaServerOnly] = {
  id: rutaServerOnly,
  filename: rutaServerOnly,
  loaded: true,
  exports: {},
} as never;

const DESTINO = new URL("../../backend/testdata/golden/planilla/", import.meta.url);
const ARCHIVOS = new URL("archivos/", DESTINO);

const BOM = String.fromCharCode(0xfeff);
const BOM_BYTES = Buffer.from([0xef, 0xbb, 0xbf]);

/* -------------------------------------------------------------------------- */
/* Azar con semilla                                                            */
/* -------------------------------------------------------------------------- */

function mulberry32(semilla: number) {
  let a = semilla >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const azar = mulberry32(20261024);
const entero = (n: number) => Math.floor(azar() * n);
const elegir = <T>(xs: readonly T[]): T => xs[entero(xs.length)];

/* -------------------------------------------------------------------------- */
/* Windows-1252                                                                */
/* -------------------------------------------------------------------------- */

/** Codifica en Windows-1252 (lo que no entra, como "?"). */
function cp1252(texto: string): Buffer {
  const decodificador = new TextDecoder("windows-1252");
  const tabla = new Map<string, number>();
  for (let b = 0; b < 256; b++) tabla.set(decodificador.decode(new Uint8Array([b])), b);
  return Buffer.from([...texto].map((c) => tabla.get(c) ?? 0x3f));
}

/* -------------------------------------------------------------------------- */
/* ZIP a mano                                                                  */
/* -------------------------------------------------------------------------- */

interface Entrada {
  nombre: string;
  datos: Buffer | string;
  /** 0: guardado; 8: deflate (por omisión). */
  metodo?: number;
  /** Tamaños en cero en el encabezado local y descriptor después (bit 3). */
  descriptor?: boolean;
  /** Extra distinto en el encabezado local y en el directorio central. */
  extraLocal?: Buffer;
  extraCentral?: Buffer;
  comentario?: string;
  /** Para romper a propósito: reemplaza los bytes comprimidos. */
  crudo?: Buffer;
}

interface OpcionesZip {
  comentario?: Buffer;
  /** Pisa el offset del directorio central en el fin del directorio. */
  offsetCentral?: number;
  /** Pisa la cantidad de entradas. */
  cantidad?: number;
  /** Basura antes del primer archivo (un ZIP autoextraíble, por ejemplo). */
  prefijo?: Buffer;
}

function zip(entradas: Entrada[], opciones: OpcionesZip = {}): Buffer {
  const partes: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  if (opciones.prefijo) {
    partes.push(opciones.prefijo);
    offset += opciones.prefijo.length;
  }

  for (const e of entradas) {
    const datos = typeof e.datos === "string" ? Buffer.from(e.datos, "utf8") : e.datos;
    const metodo = e.metodo ?? 8;
    const comprimido = e.crudo ?? (metodo === 0 ? datos : deflateRawSync(datos));
    const nombre = Buffer.from(e.nombre, "utf8");
    const extraLocal = e.extraLocal ?? Buffer.alloc(0);
    const extraCentral = e.extraCentral ?? Buffer.alloc(0);
    const comentario = Buffer.from(e.comentario ?? "", "utf8");
    const crc = crc32(datos);
    const banderas = 0x0800 | (e.descriptor ? 0x0008 : 0);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(banderas, 6);
    local.writeUInt16LE(metodo, 8);
    local.writeUInt16LE(0x6000, 10);
    local.writeUInt16LE(0x5b58, 12);
    local.writeUInt32LE(e.descriptor ? 0 : crc, 14);
    local.writeUInt32LE(e.descriptor ? 0 : comprimido.length, 18);
    local.writeUInt32LE(e.descriptor ? 0 : datos.length, 22);
    local.writeUInt16LE(nombre.length, 26);
    local.writeUInt16LE(extraLocal.length, 28);
    partes.push(local, nombre, extraLocal, comprimido);
    let largoLocal = 30 + nombre.length + extraLocal.length + comprimido.length;
    if (e.descriptor) {
      const d = Buffer.alloc(16);
      d.writeUInt32LE(0x08074b50, 0);
      d.writeUInt32LE(crc, 4);
      d.writeUInt32LE(comprimido.length, 8);
      d.writeUInt32LE(datos.length, 12);
      partes.push(d);
      largoLocal += 16;
    }

    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt16LE(banderas, 8);
    c.writeUInt16LE(metodo, 10);
    c.writeUInt16LE(0x6000, 12);
    c.writeUInt16LE(0x5b58, 14);
    c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(comprimido.length, 20);
    c.writeUInt32LE(datos.length, 24);
    c.writeUInt16LE(nombre.length, 28);
    c.writeUInt16LE(extraCentral.length, 30);
    c.writeUInt16LE(comentario.length, 32);
    c.writeUInt32LE(offset, 42);
    central.push(c, nombre, extraCentral, comentario);
    offset += largoLocal;
  }

  const inicioCentral = offset;
  const directorio = Buffer.concat(central);
  const comentario = opciones.comentario ?? Buffer.alloc(0);
  const fin = Buffer.alloc(22);
  fin.writeUInt32LE(0x06054b50, 0);
  fin.writeUInt16LE(opciones.cantidad ?? entradas.length, 8);
  fin.writeUInt16LE(opciones.cantidad ?? entradas.length, 10);
  fin.writeUInt32LE(directorio.length, 12);
  fin.writeUInt32LE(opciones.offsetCentral ?? inicioCentral, 16);
  fin.writeUInt16LE(comentario.length, 20);
  return Buffer.concat([...partes, directorio, fin, comentario]);
}

/* -------------------------------------------------------------------------- */
/* El .xlsx                                                                    */
/* -------------------------------------------------------------------------- */

const DECLARACION = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n';
const NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

const CONTENT_TYPES = `${DECLARACION}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>`;
const RELS = `${DECLARACION}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;

function libro(hojas: string[]): string {
  const sheets = hojas.map((h, i) => `<sheet name="${h}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("");
  return `${DECLARACION}<workbook ${NS}><fileVersion appName="xl"/><bookViews><workbookView xWindow="0" yWindow="0"/></bookViews><sheets>${sheets}</sheets><calcPr calcId="191029"/></workbook>`;
}

function relsLibro(n: number): string {
  const rels = Array.from({ length: n }, (_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("");
  return `${DECLARACION}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}</Relationships>`;
}

function hoja(filas: string): string {
  return `${DECLARACION}<worksheet ${NS}><dimension ref="A1:F20"/><sheetViews><sheetView workbookViewId="0"/></sheetViews><sheetFormatPr defaultRowHeight="15"/><sheetData>${filas}</sheetData><pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/></worksheet>`;
}

function compartidos(sis: string[]): string {
  return `${DECLARACION}<sst ${NS} count="${sis.length}" uniqueCount="${sis.length}">${sis.join("")}</sst>`;
}

const si = (t: string) => `<si><t>${t}</t></si>`;

// Estilos: 0 general, 1 fecha de fábrica (14), 2 personalizado dd/mm/yyyy
// (164), 3 "0.00" (2), 4 personalizado con una "d" entre comillas (165, no es
// fecha), 5 hora (21), 6 personalizado [$-F800]dddd (166).
const ESTILOS = `${DECLARACION}<styleSheet ${NS}><numFmts count="3"><numFmt numFmtId="164" formatCode="dd/mm/yyyy;@"/><numFmt numFmtId="165" formatCode="&quot;d&quot;\\ 0.00"/><numFmt numFmtId="166" formatCode="[$-F800]dddd\\,\\ mmmm\\ dd\\,\\ yyyy"/></numFmts><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="1"><fill><patternFill patternType="none"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0"/></cellStyleXfs><cellXfs count="7"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="14" fontId="0" applyNumberFormat="1"/><xf numFmtId="164" fontId="0" applyNumberFormat="1"/><xf numFmtId="2" fontId="0" applyNumberFormat="1"/><xf numFmtId="165" fontId="0" applyNumberFormat="1"/><xf numFmtId="21" applyNumberFormat="1"/><xf numFmtId="166" applyNumberFormat="1"/></cellXfs></styleSheet>`;

interface Libro {
  hojas?: string[];
  /** Una por hoja; la clave es la ruta del archivo de la hoja. */
  archivos: Record<string, string | Buffer>;
  metodo?: number;
  sinWorkbook?: boolean;
}

function xlsx(l: Libro, opciones?: OpcionesZip, ajustar?: (e: Entrada[]) => void): Buffer {
  const hojas = l.hojas ?? ["Hoja1"];
  const entradas: Entrada[] = [
    { nombre: "[Content_Types].xml", datos: CONTENT_TYPES },
    { nombre: "_rels/.rels", datos: RELS },
  ];
  if (!l.sinWorkbook) entradas.push({ nombre: "xl/workbook.xml", datos: libro(hojas) });
  entradas.push({ nombre: "xl/_rels/workbook.xml.rels", datos: relsLibro(hojas.length) });
  for (const [nombre, datos] of Object.entries(l.archivos)) entradas.push({ nombre, datos });
  for (const e of entradas) e.metodo ??= l.metodo;
  ajustar?.(entradas);
  return zip(entradas, opciones);
}

/* -------------------------------------------------------------------------- */
/* Los archivos                                                                */
/* -------------------------------------------------------------------------- */

const ENCABEZADO = "SKU;Producto;Medida;Categoria;Precio lista;Precio profesional";

function archivosDePrueba(): Record<string, Buffer> {
  const a: Record<string, Buffer> = {};

  /* ---------------------------------- CSV --------------------------------- */

  a["utf8-bom-puntoycoma.csv"] = Buffer.concat([
    BOM_BYTES,
    Buffer.from(
      [
        ENCABEZADO,
        'FEN18;Fenólico 18 mm;2440 x 1220;Placas;84.500,50;80.275,48',
        'TIR23;"Tirante 2"" x 3""";3,05 m;Maderas;"12.345,67";11.111,10',
        'MDF;"MDF crudo, de 15 mm\r\ncon salto adentro";1830 x 2600;Placas;$ 1.234;',
        "",
        ";;;;;",
        'PIN;Pino 1" x 4";;Maderas;1,234.56;1234.5',
        "CLA;Clavos;;Ferretería;  96.500  ;(1.500,00)",
        "SINPRECIO;Algo;;;abc;-",
        ";Fila sin código;;;100;200",
        "NEG;Negativo;;;-5;-0,001",
        "",
        "",
      ].join("\r\n"),
      "utf8",
    ),
  ]);

  a["utf8-coma.csv"] = Buffer.from(
    [
      "sku,producto,precio",
      'A1,"Tabla, cepillada",84500.5',
      'A2,"Con ""comillas"" adentro",1.234',
      "A3,Machimbre 1/2\",84.500",
      'A4,"campo con\nsalto",12,5',
      "A5,Sin cerrar,\"1.000",
      "",
    ].join("\n"),
    "utf8",
  );

  a["latin1-tabulador.csv"] = cp1252(
    [
      "Código\tDescripción\tPrecio lista\tPrecio profesional",
      "SKU-Ñ1\tCañuelas — Pino\t$ 1.234\t1.100",
      "SKU-Á2\tÁlamo «seco»\t1234,5\t",
      "SKU-3\tMüller € 2½\t€ 2.500,00\t2.400,00",
      "\t\t\t",
      "SKU-4\t“Comillas tipográficas”\t1,5\t1,25",
    ].join("\r\n") + "\r\n",
  );

  a["windows1252-todos.csv"] = Buffer.concat([
    Buffer.from("SKU;Todos los bytes altos\r\nX;"),
    Buffer.from(Array.from({ length: 128 }, (_, i) => 0x80 + i).filter((b) => b !== 0x22 && b !== 0x3b)),
    Buffer.from(";1\r\n"),
  ]);

  a["utf8-roto.csv"] = Buffer.concat([
    Buffer.from("SKU;Producto;Precio lista\nR1;Ca"),
    Buffer.from([0xf1]),
    Buffer.from("uelas;10,50\nR2;"),
    Buffer.from([0xe2, 0x82]),
    Buffer.from(";5\n"),
  ]);

  a["utf8-doble-bom.csv"] = Buffer.concat([BOM_BYTES, BOM_BYTES, Buffer.from("SKU;Precio\nB1;10\n")]);
  a["utf8-triple-bom.csv"] = Buffer.concat([BOM_BYTES, BOM_BYTES, BOM_BYTES, Buffer.from("SKU,Precio\nB1,10\n")]);
  a["utf8-cuadruple-bom.csv"] = Buffer.concat([BOM_BYTES, BOM_BYTES, BOM_BYTES, BOM_BYTES, Buffer.from('"SKU";Precio\nB1;10\n')]);
  a["solo-encabezado.csv"] = Buffer.from(ENCABEZADO + "\r\n");
  a["vacio.csv"] = Buffer.alloc(0);
  a["solo-saltos.csv"] = Buffer.from("\r\n\n\r\n  \n");
  a["sin-sku.csv"] = Buffer.from("Producto;Precio lista\nFenólico;100\n");
  a["solo-precio.csv"] = Buffer.from("Código SKU;Precio\nP1;1.000\nP2;\nP3;-3\n");
  a["cr-solo.csv"] = Buffer.from("SKU;Precio lista\rC1;10\rC2;20\r");
  a["comillas-sueltas.csv"] = Buffer.from('SKU;Medida;Precio lista\nQ1;2" x 4";10\nQ2;  "3" x 5";20\nQ3;"";30\nQ4;x"y"z;40\n"Q5"  ;algo;50\n');
  a["sin-salto-final.csv"] = Buffer.from("SKU;Precio lista\nF1;1");
  a["empate-separadores.csv"] = Buffer.from("a;b,c\tSKU\nx;y,z\t1\n");
  a["espacios-unicode.csv"] = Buffer.from(`SKU;Precio lista\n U1 ;  10 　\n\u0085U2\u0085; 5\n${BOM}U3;7\n`, "utf8");

  /* --------------------------------- XLSX --------------------------------- */

  const textos = [
    si("SKU"),
    si("Producto"),
    si("Precio lista"),
    si("Precio profesional"),
    si("Fenólico 18 mm"),
    '<si><t xml:space="preserve">  con espacios  </t></si>',
    "<si><r><t>Texto </t></r><r><rPr><b/></rPr><t>con formato</t></r></si>",
    si("Tom &amp; Jerry &lt;b&gt; &quot;x&quot; &apos;y&apos;"),
    si("Línea&#10;dos &#x41; &#0; &#1; &#65536; &unknown;"),
    "<si><t/></si>",
    "<si><t>Pino</t><rPh sb=\"0\" eb=\"1\"><t>ピノ</t></rPh><phoneticPr fontId=\"1\"/></si>",
    si("<![CDATA[Con <cdata> & todo]]>"),
    "<si><t>a</t><t>b</t></si>",
    "<si><r><t xml:space=\"preserve\"> uno </t></r><r><t>dos</t></r></si>",
    si("007"),
    si("Ñandú _x000D_ escape de Excel"),
  ];

  const filasCompleto = [
    // Encabezado con textos compartidos.
    '<row r="1" spans="1:6"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c><c r="D1" t="s"><v>3</v></c></row>',
    // Números, fórmula con valor en caché, fecha de fábrica.
    '<row r="2"><c r="A2" t="s"><v>14</v></c><c r="B2" t="s"><v>4</v></c><c r="C2" s="3"><v>84500.5</v></c><c r="D2"><f>C2*0.95</f><v>80275.475</v></c><c r="E2" s="1"><v>46269</v></c><c r="F2" s="2"><v>46269.75</v></c></row>',
    // Celdas salteadas: C3 sin B3, F3 sin D3 ni E3.
    '<row r="3"><c r="A3" t="s"><v>5</v></c><c r="C3"><v>12</v></c><c r="F3" t="s"><v>6</v></c></row>',
    // Booleanos, errores, inlineStr, str de fórmula.
    '<row r="4"><c r="A4" t="b"><v>1</v></c><c r="B4" t="b"><v>0</v></c><c r="C4" t="e"><v>#N/A</v></c><c r="D4" t="inlineStr"><is><t>escrito adentro</t></is></c><c r="E4" t="str"><f>A1&amp;"x"</f><v>SKUx</v></c><c r="F4" t="inlineStr"><is><r><t>rico</t></r></is></c></row>',
    // Entidades, numéricas, CDATA, vacío, fases.
    '<row r="5"><c r="A5" t="s"><v>7</v></c><c r="B5" t="s"><v>8</v></c><c r="C5" t="s"><v>9</v></c><c r="D5" t="s"><v>10</v></c><c r="E5" t="s"><v>11</v></c><c r="F5" t="s"><v>12</v></c></row>',
    // Fechas: serie 59 y 60 (el 29/2/1900 de Lotus), 61, horas, fracción.
    '<row r="6"><c r="A6" s="1"><v>59</v></c><c r="B6" s="1"><v>60</v></c><c r="C6" s="1"><v>61</v></c><c r="D6" s="5"><v>0.5</v></c><c r="E6" s="1"><v>1</v></c><c r="F6" s="6"><v>45000.999999</v></c></row>',
    // No son fecha: estilo 4 (la "d" entre comillas), texto con estilo de fecha, cero, negativo.
    '<row r="7"><c r="A7" s="4"><v>46269</v></c><c r="B7" s="1" t="s"><v>13</v></c><c r="C7" s="1"><v>0</v></c><c r="D7" s="1"><v>-5</v></c><c r="E7" s="1"><v>abc</v></c><c r="F7" s="99"><v>46269</v></c></row>',
    // Índices raros a la tabla compartida y celdas fuera de orden.
    '<row r="8"><c r="C8" t="s"><v>15</v></c><c r="A8" t="s"><v>1.0</v></c><c r="B8" t="s"><v> 2 </v></c><c r="D8" t="s"><v>99</v></c><c r="E8" t="s"><v>-0</v></c><c r="F8" t="s"><v>1.5</v></c></row>',
    // Referencias raras: minúscula, con $, sin referencia, duplicada.
    '<row r="9"><c r="a9"><v>perdida</v></c><c r="$B$9"><v>tambien</v></c><c><v>sin ref</v></c><c r="D9"><v>d</v></c><c r="D9"><v>pisada</v></c><c><v>sigue</v></c></row>',
    // Fila vacía en el medio, fila con solo atributos.
    '<row r="10"/>',
    '<row r="11" spans="1:6" ht="20" customHeight="1"><c r="B11" s="1"/><c r="C11"><v></v></c></row>',
    // Columnas de dos letras.
    '<row r="12"><c r="AA12"><v>col 27</v></c></row>',
    // Valores con espacios y saltos que el parser recorta.
    '<row r="13"><c r="A13"><v>\r\n  15  \r\n</v></c><c r="B13" t="inlineStr"><is><t xml:space="preserve">  hola  </t></is></c></row>',
    // Filas vacías al final (con formato): se descartan.
    '<row r="14"><c r="A14" s="3"/></row>',
    '<row r="15"/>',
  ].join("");

  a["completo.xlsx"] = xlsx({
    hojas: ["Precios", "Otra"],
    archivos: {
      "xl/worksheets/sheet1.xml": hoja(filasCompleto),
      "xl/worksheets/sheet2.xml": hoja('<row r="1"><c r="A1"><v>segunda hoja</v></c></row>'),
      "xl/sharedStrings.xml": compartidos(textos),
      "xl/styles.xml": ESTILOS,
    },
  });

  a["completo-guardado.xlsx"] = xlsx({
    hojas: ["Precios"],
    metodo: 0,
    archivos: {
      "xl/worksheets/sheet1.xml": hoja(filasCompleto),
      "xl/sharedStrings.xml": compartidos(textos),
      "xl/styles.xml": ESTILOS,
    },
  });

  // Una planilla de precios como la que sube el cliente.
  const preciosCompartidos = ["SKU", "Producto", "Precio lista", "Precio profesional", "Fenólico", "Tirante 2\" x 3\""].map(si);
  const filasPrecios = [
    '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c><c r="D1" t="s"><v>3</v></c></row>',
    '<row r="2"><c r="A2" t="inlineStr"><is><t>FEN18</t></is></c><c r="B2" t="s"><v>4</v></c><c r="C2"><v>84500.5</v></c><c r="D2"><v>80275.475</v></c></row>',
    '<row r="3"><c r="A3"><v>12345</v></c><c r="B3" t="s"><v>5</v></c><c r="C3" t="inlineStr"><is><t>12.345,67</t></is></c></row>',
    '<row r="4"><c r="A4" t="inlineStr"><is><t>SIN</t></is></c><c r="C4" t="e"><v>#VALUE!</v></c><c r="D4"><v>-10</v></c></row>',
    '<row r="5"><c r="B5" t="s"><v>4</v></c><c r="C5"><v>1</v></c></row>',
    '<row r="6"><c r="A6" t="inlineStr"><is><t>FEC</t></is></c><c r="C6" s="1"><v>46269</v></c><c r="D6"><v>0.125</v></c></row>',
    '<row r="7"><c r="A7" t="inlineStr"><is><t>GRANDE</t></is></c><c r="C7"><v>1E+21</v></c><c r="D7"><v>123456789012345680000</v></c></row>',
  ].join("");
  a["precios.xlsx"] = xlsx({
    hojas: ["Lista de precios"],
    archivos: {
      "xl/worksheets/sheet1.xml": hoja(filasPrecios),
      "xl/sharedStrings.xml": compartidos(preciosCompartidos),
      "xl/styles.xml": ESTILOS,
    },
  });

  // Sin sheet1: el TS toma la primera en orden alfabético (sheet10), pero el
  // nombre sale de la primera hoja del libro.
  a["hojas-orden.xlsx"] = xlsx({
    hojas: ["Primera", "Segunda"],
    archivos: {
      "xl/worksheets/sheet2.xml": hoja('<row r="1"><c r="A1"><v>soy sheet2</v></c></row>'),
      "xl/worksheets/sheet10.xml": hoja('<row r="1"><c r="A1"><v>soy sheet10</v></c></row>'),
      "xl/worksheets/sheetX.xml": hoja('<row r="1"><c r="A1"><v>no cuenta</v></c></row>'),
    },
  });

  a["sin-hoja.xlsx"] = xlsx({ archivos: { "xl/styles.xml": ESTILOS } });
  a["sin-workbook.xlsx"] = xlsx({ sinWorkbook: true, archivos: { "xl/worksheets/sheet1.xml": hoja('<row r="1"><c r="A1"><v>1</v></c></row>') } });
  a["sin-compartidos.xlsx"] = xlsx({ archivos: { "xl/worksheets/sheet1.xml": hoja('<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1"><v>2</v></c></row>') } });
  a["hoja-con-comillas.xlsx"] = xlsx({ hojas: ["Precios &quot;2026&quot; &amp; más"], archivos: { "xl/worksheets/sheet1.xml": hoja('<row r="1"><c r="A1"><v>1</v></c></row>') } });
  a["hoja-vacia.xlsx"] = xlsx({ archivos: { "xl/worksheets/sheet1.xml": hoja("") } });
  a["hoja-una-fila.xlsx"] = xlsx({ archivos: { "xl/worksheets/sheet1.xml": hoja('<row r="1"><c r="B1" t="inlineStr"><is><t>sola</t></is></c></row>') } });

  // Con prefijos de espacio de nombres (x:): fast-xml-parser no los saca, y el TS no encuentra las filas.
  a["prefijo-x.xlsx"] = xlsx({
    archivos: {
      "xl/worksheets/sheet1.xml": `<?xml version="1.0"?><x:worksheet xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><x:sheetData><x:row r="1"><x:c r="A1"><x:v>1</x:v></x:c></x:row></x:sheetData></x:worksheet>`,
    },
  });

  // BOM, CRLF, comentarios, PI, CDATA y DOCTYPE simple.
  a["xml-raro.xlsx"] = xlsx({
    archivos: {
      "xl/worksheets/sheet1.xml": Buffer.concat([
        BOM_BYTES,
        Buffer.from(
          `<?xml version="1.0"?>\r\n<!DOCTYPE worksheet>\r\n<!-- comentario -->\r\n<worksheet><sheetData>\r\n<row r="1"><c r="A1"><v>a<!-- x -->b</v></c><c r="B1"><v><![CDATA[  cdata  ]]></v></c><c r="C1"><v>x<?pi y?>z</v></c><c r="D1" t="inlineStr"><is><t>ta<![CDATA[]]>b</t></is></c></row>\r\n<row r="2"><c\tr="A2"\tt="inlineStr"><is><t>tab</t></is></c><c r='B2' t='inlineStr'><is><t>simples</t></is></c><c r = "C2" t = "inlineStr" ><is><t>espacios</t></is></c><c r="D2" t="inlineStr" ><is ><t >x</t ></is ></c ></row>\r\n</sheetData></worksheet>`,
        ),
      ]),
    },
  });

  // Etiquetas mal cerradas: el parser no compara los nombres.
  a["xml-permisivo.xlsx"] = xlsx({
    archivos: {
      "xl/worksheets/sheet1.xml": `<worksheet><sheetData><row><c r="A1"><v>1</x></c><c r="B1"><v>2</v></row></c></sheetData><row><c r="A9"><v>afuera</v></c></row></worksheet>`,
      "xl/sharedStrings.xml": "<sst><si><t>sin cerrar",
    },
  });

  a["xml-sin-cerrar-comentario.xlsx"] = xlsx({ archivos: { "xl/worksheets/sheet1.xml": "<worksheet><!-- nunca" } });
  a["xml-sin-cerrar-etiqueta.xlsx"] = xlsx({ archivos: { "xl/worksheets/sheet1.xml": '<worksheet><sheetData><row r="1"' } });
  a["xml-sin-cerrar-cdata.xlsx"] = xlsx({ archivos: { "xl/worksheets/sheet1.xml": "<worksheet><![CDATA[x" } });
  a["xml-sin-cerrar-cierre.xlsx"] = xlsx({ archivos: { "xl/worksheets/sheet1.xml": "<worksheet></worksheet" } });
  a["xml-sin-cerrar-pi.xlsx"] = xlsx({ archivos: { "xl/worksheets/sheet1.xml": "<?xml version='1.0'" } });
  a["xml-constructor.xlsx"] = xlsx({ archivos: { "xl/worksheets/sheet1.xml": "<worksheet><constructor/></worksheet>" } });
  a["xml-cierre-proto.xlsx"] = xlsx({ archivos: { "xl/worksheets/sheet1.xml": "<worksheet></__proto__>" } });
  a["xml-tostring.xlsx"] = xlsx({ archivos: { "xl/worksheets/sheet1.xml": '<worksheet><sheetData><row><toString/><c r="A1"><v>1</v></c><valueOf a="1"><v>2</v></valueOf></row></sheetData></worksheet>' } });
  a["xml-text.xlsx"] = xlsx({ archivos: { "xl/worksheets/sheet1.xml": "<worksheet><#text>1</#text></worksheet>" } });
  a["xml-anidado.xlsx"] = xlsx({ archivos: { "xl/worksheets/sheet1.xml": "<a>".repeat(102) } });
  a["xml-anidado-justo.xlsx"] = xlsx({ archivos: { "xl/worksheets/sheet1.xml": "<a>".repeat(101) } });
  a["xml-doctype-doble.xlsx"] = xlsx({ archivos: { "xl/worksheets/sheet1.xml": "<!DOCTYPE a><!DOCTYPE b><worksheet/>" } });
  a["xml-doctype-malo.xlsx"] = xlsx({ archivos: { "xl/worksheets/sheet1.xml": "<!Doctype a><worksheet/>" } });
  a["xml-doctype-abierto.xlsx"] = xlsx({ archivos: { "xl/worksheets/sheet1.xml": '<!DOCTYPE a "x>y" <!-- c --> <worksheet/>' } });
  a["xml-doctype-cuerpo.xlsx"] = xlsx({ archivos: { "xl/worksheets/sheet1.xml": '<!DOCTYPE a [ <!-- c > --> <!ATTLIST x y CDATA #IMPLIED> ]><worksheet><sheetData><row><c><v>ok</v></c></row></sheetData></worksheet>' } });
  // Estas dos no las reproduce el Go (ver DIFERENCIAS en planilla_test.go).
  a["xml-doctype-entidad.xlsx"] = xlsx({ archivos: { "xl/worksheets/sheet1.xml": '<!DOCTYPE a [ <!ENTITY marca "MJBJ"> ]><worksheet><sheetData><row><c t="inlineStr"><is><t>&marca;</t></is></c></row></sheetData></worksheet>' } });
  a["estilos-formatcode-etiqueta.xlsx"] = xlsx({
    archivos: {
      "xl/worksheets/sheet1.xml": hoja('<row r="1"><c r="A1"><v>1</v></c></row>'),
      "xl/styles.xml": "<styleSheet><numFmts><numFmt numFmtId=\"164\"><@formatCode>d</@formatCode></numFmt></numFmts></styleSheet>",
    },
  });
  a["xml-doctype-invalido.xlsx"] =xlsx({ archivos: { "xl/worksheets/sheet1.xml": "<!DOCTYPE a [ <x> ]><worksheet/>" } });
  a["xml-version-11.xlsx"] = xlsx({ archivos: { "xl/worksheets/sheet1.xml": '<?xml version="1.1"?><worksheet><sheetData><row><c t="inlineStr"><is><t>a&#1;b&#9;c&#0;d&#xD800;e</t></is></c></row></sheetData></worksheet>' } });
  a["xml-version-10.xlsx"] = xlsx({ archivos: { "xl/worksheets/sheet1.xml": '<?xml version="1.0"?><worksheet><sheetData><row><c t="inlineStr"><is><t>a&#1;b&#9;c&#0;d&#xD800;e&#-0;f&#x0x1;g&#  3;h&#12abc;i</t></is></c></row></sheetData></worksheet>' } });
  a["xml-entidades-ventana.xlsx"] = xlsx({ archivos: { "xl/worksheets/sheet1.xml": `<worksheet><sheetData><row><c t="inlineStr"><is><t>&${"x".repeat(31)}; &${"y".repeat(32)}; &amp &;amp; &&amp; &lt;😀&gt;</t></is></c></row></sheetData></worksheet>` } });
  a["xml-atributos.xlsx"] = xlsx({
    archivos: {
      "xl/worksheets/sheet1.xml": `<worksheet><sheetData><row><c r="  B1  " t=" inlineStr "><is><t>recortado</t></is></c><c r="C1" r="D1"><v>dos r</v></c><c r=E1><v>sin comillas</v></c><c r="F1 t="s"><v>0</v></c><c r="G1" s="1&amp;"><v>46269</v></c><c r="A2"s="1"><v>46269</v></c></row></sheetData></worksheet>`,
      "xl/styles.xml": ESTILOS,
      "xl/sharedStrings.xml": compartidos([si("cero")]),
    },
  });
  a["xml-arrays.xlsx"] = xlsx({
    archivos: {
      "xl/workbook.xml": `<workbook><sheets><sheet name="A"/><sheet name="B"/></sheets><sheets><sheet name="C"/></sheets></workbook>`,
      "xl/worksheets/sheet1.xml": `<worksheet><sheetData><row><c r="A1"><v>1</v><v>2</v></c><c r="B1" t="s"><v>0</v></c></row></sheetData><sheetData><row><c><v>x</v></c></row></sheetData></worksheet>`,
      "xl/sharedStrings.xml": `<sst><si><t>uno</t></si></sst><sst><si><t>dos</t></si></sst>`,
    },
  }, undefined, (e) => {
    const i = e.findIndex((x) => x.nombre === "xl/workbook.xml");
    e.splice(i, 1);
  });
  a["xml-celda-texto.xlsx"] = xlsx({
    archivos: { "xl/worksheets/sheet1.xml": `<worksheet><sheetData><row><c>suelto</c><c r="C1">5</c><c r="D1"><v>ok</v></c></row><row>texto de fila</row><row><c r="A3"><v a="1">con attr</v></c><c r="B3" t="inlineStr"><is>sin t</is></c><c r="C3" t="inlineStr"><is><t a="b">t con attr</t></is></c></row></sheetData></worksheet>` },
  });
  a["xml-arroba.xlsx"] = xlsx({
    hojas: ["Real"],
    archivos: { "xl/worksheets/sheet1.xml": `<worksheet><sheetData><row><c><@r>C1</@r><v>tag arroba</v></c><c r="E1" t="s"><@t>n</@t><v>7</v></c></row></sheetData></worksheet>` },
  });
  a["xml-sheet-nombre-raro.xlsx"] = xlsx({
    archivos: {
      "xl/workbook.xml": `<workbook><sheets><sheet>sin atributos</sheet></sheets></workbook>`,
      "xl/worksheets/sheet1.xml": hoja('<row r="1"><c r="A1"><v>1</v></c></row>'),
    },
  }, undefined, (e) => {
    const i = e.findIndex((x) => x.nombre === "xl/workbook.xml");
    e.splice(i, 1);
  });

  // Estilos raros.
  a["estilos-raros.xlsx"] = xlsx({
    archivos: {
      "xl/worksheets/sheet1.xml": hoja('<row r="1"><c r="A1" s="0"><v>46269</v></c><c r="B1" s="1"><v>46269</v></c><c r="C1" s="2"><v>46269</v></c><c r="D1" s="3"><v>46269</v></c><c r="E1" s=" 1 "><v>46269</v></c><c r="F1" s="x"><v>46269</v></c></row>'),
      "xl/styles.xml": `<styleSheet><numFmts><numFmt numFmtId="x" formatCode="yyyy"/><numFmt numFmtId="200" formatCode="hh:mm"/><numFmt numFmtId="201" formatCode="[Red]&quot;dia&quot;0"/></numFmts><cellXfs><xf/><xf numFmtId="nope"/><xf numFmtId="200"/><xf numFmtId="0x2F"/></cellXfs></styleSheet>`,
    },
  });
  a["estilos-un-xf.xlsx"] = xlsx({
    archivos: {
      "xl/worksheets/sheet1.xml": hoja('<row r="1"><c r="A1" s="0"><v>46269.5</v></c></row>'),
      "xl/styles.xml": `<styleSheet><numFmts><numFmt numFmtId="170" formatCode="d"/></numFmts><cellXfs><xf numFmtId="170"/></cellXfs></styleSheet>`,
    },
  });
  a["estilos-vacios.xlsx"] = xlsx({
    archivos: { "xl/worksheets/sheet1.xml": hoja('<row r="1"><c r="A1" s="0"><v>46269</v></c></row>'), "xl/styles.xml": "<styleSheet/>" },
  });
  a["fecha-enorme.xlsx"] = xlsx({
    archivos: { "xl/worksheets/sheet1.xml": hoja('<row r="1"><c r="A1" s="1"><v>1e9</v></c></row>'), "xl/styles.xml": ESTILOS },
  });
  a["fecha-lejana.xlsx"] = xlsx({
    archivos: { "xl/worksheets/sheet1.xml": hoja('<row r="1"><c r="A1" s="1"><v>2958465</v></c><c r="B1" s="1"><v>2958466.5</v></c><c r="C1" s="1"><v>100000000</v></c><c r="D1" s="1"><v>1e-9</v></c><c r="E1" s="1"><v>0x10</v></c></row>'), "xl/styles.xml": ESTILOS },
  });

  /* ---------------------------------- ZIP --------------------------------- */

  const simple = { archivos: { "xl/worksheets/sheet1.xml": hoja('<row r="1"><c r="A1" t="inlineStr"><is><t>zip</t></is></c></row>') } };
  a["zip-descriptor.xlsx"] = xlsx(simple, undefined, (e) => e.forEach((x) => (x.descriptor = true)));
  a["zip-extras.xlsx"] = xlsx(simple, undefined, (e) => e.forEach((x) => {
    x.extraLocal = Buffer.from("UT\x05\x00\x01\x00\x00\x00\x00", "latin1");
    x.extraCentral = Buffer.alloc(0);
    x.comentario = "comentario de entrada";
  }));
  a["zip-comentario.xlsx"] = xlsx(simple, { comentario: Buffer.from("Comentario del ZIP con PK\x05\x06 adentro", "latin1") });
  a["zip-prefijo.xlsx"] = Buffer.concat([Buffer.from("PK"), xlsx(simple)]);
  a["zip64.xlsx"] = xlsx(simple, { offsetCentral: 0xffffffff });
  a["zip-offset-afuera.xlsx"] = xlsx(simple, { offsetCentral: 0x7ffffff0 });
  a["zip-offset-corrido.xlsx"] = xlsx(simple, { offsetCentral: 10 });
  a["zip-cantidad-de-mas.xlsx"] = xlsx(simple, { cantidad: 50 });
  a["zip-cantidad-cero.xlsx"] = xlsx(simple, { cantidad: 0 });
  a["zip-solo-pk.xlsx"] = Buffer.from("PK");
  a["zip-sin-indice.xlsx"] = Buffer.concat([Buffer.from("PK\x03\x04"), Buffer.alloc(100, 7)]);
  const entero_ = xlsx(simple);
  a["zip-truncado.xlsx"] = entero_.subarray(0, entero_.length - 30);
  a["zip-deflate-truncado.xlsx"] = xlsx(simple, undefined, (e) => {
    const h = e.find((x) => x.nombre === "xl/worksheets/sheet1.xml")!;
    const c = deflateRawSync(Buffer.from(h.datos as string));
    h.crudo = c.subarray(0, c.length - 5);
  });
  a["zip-deflate-roto.xlsx"] = xlsx(simple, undefined, (e) => {
    e[0].crudo = Buffer.from([0xff, 0xff, 0xff, 0xff]);
  });
  a["zip-metodo-raro.xlsx"] = xlsx(simple, undefined, (e) => {
    e[1].metodo = 12;
    e[1].crudo = Buffer.from([0x03, 0x00]);
  });
  a["zip-nombre-latin1.xlsx"] = xlsx(simple, undefined, (e) => {
    e.push({ nombre: "xl/worksheets/sheet0.xml", datos: hoja('<row r="1"><c r="A1"><v>la cero</v></c></row>') });
    e.push({ nombre: "docs/caña.txt", datos: "x" });
  });
  a["zip-duplicado.xlsx"] = xlsx(simple, undefined, (e) => {
    e.push({ nombre: "xl/worksheets/sheet1.xml", datos: hoja('<row r="1"><c r="A1"><v>la segunda gana</v></c></row>') });
  });

  /* ------------------------------ Otros formatos ------------------------------ */

  a["viejo.xls"] = Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(504, 0)]);
  a["casi-ole.xls"] = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a]);
  a["documento.pdf"] = Buffer.from("%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n");
  a["casi-pdf.csv"] = Buffer.from("%PD;F\n1;2\n");

  return a;
}

/* -------------------------------------------------------------------------- */
/* Variantes al azar                                                           */
/* -------------------------------------------------------------------------- */

const PIEZAS_XML = [
  "<", ">", "/", '"', "'", "&", ";", "&amp;", "&lt;", "&#10;", "&#0;", "&#x1F600;", " ", "\t", "\r\n", "\n", "é", "😀", "=",
  "<![CDATA[x]]>", "<!-- c -->", "<?pi a=\"1\"?>", "<!DOCTYPE x>", "<!X>", "<c r=\"B2\"><v>1</v></c>", "</row>", "<row>",
  "<t>", "</t>", "<v>", "</v>", "x=\"y\"", "<c/>", "<c r=\"Z9\" t=\"s\"><v>0</v></c>", "<c t=\"inlineStr\"><is><t>i</t></is></c>",
  "s=\"1\"", "t=\"b\"", "<v>46269</v>", "</c>", "<si><t>n</t></si>", "<r><t>r</t></r>", " ", "﻿", "<a/>", "</>",
];

// Sin comillas, para que la mutación no se trague el resto del archivo dentro de un atributo.
const PIEZAS_SIN_COMILLAS = PIEZAS_XML.filter((p) => !p.includes("\"") && !p.includes("'"));

function mutar(texto: string, veces: number): string {
  const piezas = entero(2) ? PIEZAS_XML : PIEZAS_SIN_COMILLAS;
  let s = texto;
  for (let k = 0; k < veces; k++) {
    const i = entero(s.length + 1);
    switch (entero(4)) {
      case 0:
        s = s.slice(0, i) + elegir(piezas) + s.slice(i);
        break;
      case 1:
        s = s.slice(0, i) + s.slice(i + 1 + entero(6));
        break;
      case 2: {
        const j = entero(s.length + 1);
        const [d, h] = i < j ? [i, j] : [j, i];
        s = s.slice(0, d) + s.slice(d, Math.min(h, d + 40)) + s.slice(d);
        break;
      }
      default: {
        const j = entero(s.length);
        s = s.slice(0, j) + elegir(piezas) + s.slice(j + 1);
      }
    }
  }
  return s;
}

const BASE_HOJA = hoja(
  '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c></row>' +
    '<row r="2"><c r="A2" t="s"><v>3</v></c><c r="C2" s="1"><v>46269.25</v></c><c r="D2"><f>C2</f><v>12.5</v></c></row>' +
    '<row r="3"><c r="B3" t="inlineStr"><is><t xml:space="preserve"> in </t></is></c><c r="E3" t="b"><v>1</v></c></row>',
);
const BASE_COMPARTIDOS = compartidos([si("SKU"), si("Precio lista"), "<si><r><t>Pre</t></r><r><t>cio</t></r></si>", si("A&amp;B")]);
const BASE_LIBRO = libro(["Precios", "B"]);

function variantesXml(n: number): Buffer[] {
  const salida: Buffer[] = [];
  for (let k = 0; k < n; k++) {
    const veces = 1 + entero(6);
    const cual = entero(4);
    const archivos: Record<string, string> = {
      "xl/worksheets/sheet1.xml": cual === 0 || cual === 3 ? mutar(BASE_HOJA, veces) : BASE_HOJA,
      "xl/sharedStrings.xml": cual === 1 || cual === 3 ? mutar(BASE_COMPARTIDOS, veces) : BASE_COMPARTIDOS,
      "xl/styles.xml": cual === 2 ? mutar(ESTILOS, veces) : ESTILOS,
    };
    salida.push(
      xlsx({ hojas: ["Precios", "B"], metodo: entero(2) ? 0 : 8, archivos }, undefined, (e) => {
        if (cual === 3) e.find((x) => x.nombre === "xl/workbook.xml")!.datos = mutar(BASE_LIBRO, veces);
      }),
    );
  }
  return salida;
}

function variantesZip(n: number): Buffer[] {
  const base = xlsx({ metodo: 0, archivos: { "xl/worksheets/sheet1.xml": BASE_HOJA, "xl/sharedStrings.xml": BASE_COMPARTIDOS } });
  const comprimido = xlsx({ archivos: { "xl/worksheets/sheet1.xml": BASE_HOJA, "xl/sharedStrings.xml": BASE_COMPARTIDOS } });
  const salida: Buffer[] = [];
  for (let k = 0; k < n; k++) {
    const b = Buffer.from(entero(2) ? base : comprimido);
    const veces = 1 + entero(4);
    for (let m = 0; m < veces; m++) {
      // La mitad de las veces se rompe el directorio central y el final.
      const desde = entero(2) ? Math.max(0, b.length - 400) : 0;
      b[desde + entero(b.length - desde)] = entero(256);
    }
    salida.push(entero(8) === 0 ? b.subarray(0, entero(b.length)) : b);
  }
  return salida;
}

const ALFABETO_CSV = [";", ",", "\t", '"', '""', "\n", "\r\n", "\r", " ", "a", "Ñ", "é", "1", "2,5", "1.234", "$", "-", "(", ")", "SKU", "Precio lista", "profesional", "﻿"];

function variantesCsv(n: number): Buffer[] {
  const salida: Buffer[] = [];
  for (let k = 0; k < n; k++) {
    const partes: string[] = [];
    const largo = entero(40);
    for (let m = 0; m < largo; m++) partes.push(elegir(ALFABETO_CSV));
    let b = Buffer.from(partes.join(""), "utf8");
    if (entero(3) === 0) {
      // Bytes sueltos que no son UTF-8.
      const extra = Buffer.from(Array.from({ length: 1 + entero(4) }, () => 0x80 + entero(128)));
      const i = entero(b.length + 1);
      b = Buffer.concat([b.subarray(0, i), extra, b.subarray(i)]);
    }
    salida.push(b);
  }
  return salida;
}

/** Escribe bits como los lee deflate: del menos significativo al más. */
function bloquesFijos(piezas: [valor: number, bits: number, huffman?: boolean][]): Buffer {
  const salida: number[] = [];
  let acumulado = 0;
  let cuantos = 0;
  for (const [valor, bits, huffman] of piezas) {
    for (let k = 0; k < bits; k++) {
      // Los códigos de Huffman van del bit más significativo al menos.
      const bit = huffman ? (valor >> (bits - 1 - k)) & 1 : (valor >> k) & 1;
      acumulado |= bit << cuantos;
      if (++cuantos === 8) {
        salida.push(acumulado);
        acumulado = cuantos = 0;
      }
    }
  }
  if (cuantos) salida.push(acumulado);
  return Buffer.from(salida);
}

/** Flujos escritos a mano para los errores que el azar no encuentra. */
const DEFLATE_A_MANO = [
  // Bloque fijo con el literal 286 (no existe): 11000110.
  bloquesFijos([[1, 1], [1, 2], [0xc6, 8, true]]),
  // Literal 287.
  bloquesFijos([[1, 1], [1, 2], [0x41 + 0x30, 8, true], [0xc7, 8, true]]),
  // Largo 3 (257 = 0000001) con la distancia 30 (11110), que no existe.
  bloquesFijos([[1, 1], [1, 2], [0x30 + 0x41, 8, true], [1, 7, true], [30, 5, true]]),
  // Distancia 31.
  bloquesFijos([[1, 1], [1, 2], [1, 7, true], [31, 5, true]]),
  // Distancia 0 sin nada escrito antes: demasiado lejos.
  bloquesFijos([[1, 1], [1, 2], [1, 7, true], [0, 5, true]]),
  // Un "A" y el fin de bloque: válido.
  bloquesFijos([[1, 1], [1, 2], [0x30 + 0x41, 8, true], [0, 7, true]]),
  // Dos bloques: el primero no es el último.
  bloquesFijos([[0, 1], [1, 2], [0x30 + 0x42, 8, true], [0, 7, true], [1, 1], [1, 2], [0, 7, true]]),
  // Bloque guardado vacío; guardado con LEN y NLEN que no cierran.
  Buffer.from([0x01, 0x00, 0x00, 0xff, 0xff]),
  Buffer.from([0x01, 0x01, 0x00, 0xff, 0xff, 0x41]),
];

/** Deflate al azar: flujos válidos rotos y bytes sueltos. */
function variantesDeflate(n: number): Buffer[] {
  const fuentes = [
    Buffer.from(BASE_HOJA),
    Buffer.from("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaab"),
    Buffer.from("hola"),
    Buffer.alloc(0),
    Buffer.from(Array.from({ length: 300 }, () => entero(256))),
  ];
  const salida: Buffer[] = [];
  for (let k = 0; k < n; k++) {
    const tipo = entero(5);
    if (tipo === 0) {
      salida.push(Buffer.from(Array.from({ length: entero(24) }, () => entero(256))));
      continue;
    }
    const nivel = elegir([0, 1, 6, 9]);
    const estrategia = elegir([0, 1, 2, 3, 4]); // por omisión, filtrado, huffman, rle, fijo
    const b = Buffer.from(deflateRawSync(elegir(fuentes), { level: nivel, strategy: estrategia }));
    if (tipo === 1) {
      salida.push(b.subarray(0, entero(b.length + 1)));
      continue;
    }
    const veces = 1 + entero(3);
    for (let m = 0; m < veces && b.length > 0; m++) b[entero(b.length)] ^= 1 << entero(8);
    salida.push(tipo === 4 ? Buffer.concat([b, Buffer.from([entero(256), entero(256)])]) : b);
  }
  return salida;
}

/* -------------------------------------------------------------------------- */

async function main() {
  const { leerPlanilla } = await import("./originales/planilla");
  const csv = await import("./originales/csv");
  const precios = await import("./originales/precios-csv");

  rmSync(ARCHIVOS, { recursive: true, force: true });
  mkdirSync(ARCHIVOS, { recursive: true });

  const leer = (datos: Uint8Array) => {
    const leida = leerPlanilla(datos);
    return { leida, filas: precios.leerFilas(leida.filas) };
  };

  // Archivos escritos a mano.
  const archivos = Object.entries(archivosDePrueba()).map(([nombre, datos]) => {
    writeFileSync(new URL(nombre, ARCHIVOS), datos);
    return { archivo: nombre, ...leer(datos) };
  });

  // Variantes al azar: van en base64 adentro del JSON.
  const variantes = [
    ...variantesXml(1200).map((b) => ({ tipo: "xml", b })),
    ...variantesZip(400).map((b) => ({ tipo: "zip", b })),
    ...variantesCsv(400).map((b) => ({ tipo: "csv", b })),
  ].map(({ tipo, b }) => ({ tipo, datos: b.toString("base64"), ...leer(b) }));

  const inflados = [...DEFLATE_A_MANO, ...variantesDeflate(4000)].map((b) => {
    try {
      return { datos: b.toString("base64"), salida: inflateRawSync(b).toString("base64") };
    } catch (error) {
      return { datos: b.toString("base64"), error: (error as Error).message };
    }
  });

  // Casos sueltos.
  const numeros = [
    "", " ", "84.500,50", "84500.5", "$ 1.234", "1,234.56", "basura", "abc", "12.345,67", "12345.67", "$ 12.345",
    "12345", "(1.500,00)", "(1500)", "( 1.500 )", "(1\n2)", "-", "--5", "1-2", "-5", "- 5", "5-", "12,5", "1,234", "1,2345",
    "1.234.567,89", "1,234,567.89", "1.234.567", "1,2,3", "1.2.3", "0,1250", "2,6750", "1,0050", "0,125", "-0,001", "(0,0010)",
    "0", "-0", "(0)", "0,00", ".5", ",5", "5.", "5,", ".", ",", "..", ",,", ".,", ",.", "...", "96.500", "96.50", "96.5000",
    "1e5", "1E5", "Infinity", "NaN", "0x10", "  7  ", " 7 ", "﻿8", "\u00859", "1 234,5", "1'234.5", "€ 2.500,00",
    "US$ 3.000", "ARS 1.000,5", "12%", "12 %", "-(5)", "(-5)", "((5))", "(5", "5)", "999999999999999999999", "9".repeat(25),
    "9".repeat(400), "0." + "0".repeat(30) + "1", "123456789.125", "0.005", "1.005", "1,005", "2.675", "1.0E3", "٣", "１２",
  ];
  for (let k = 0; k < 2500; k++) {
    numeros.push(Array.from({ length: 1 + entero(9) }, () => elegir(["0", "1", "5", "9", ".", ",", "-", "(", ")", "$", " ", "e", "x"])).join(""));
  }
  const encabezados = [
    "", "SKU", "sku", "Código SKU", "Razón Social", "razon_social", "PRECIO LISTA", "Precio  profesional", "Ñandú", "İstanbul",
    "ﬁno", "Ａ", "ẞ", "Ǆ", "Ω", "K", "Å", "ℌ", "Ⅻ", "①", "d́", "å", "1º", "2ª", "x²", "precio_lista(ARS)", "  SKU  ",
    "Categoría", "Descripción", "﻿SKU", "ÀÉÎÕÜ àéîõü çÇ", "ŁÓDŹ", "Ŀl", "ı", "😀sku",
  ];
  const separadores = [
    "", "a;b;c", "a,b,c", "a\tb\tc", "a;b,c", "a,b;c", "a;b,c,d", "a\tb;c", "﻿a,b", "a,b\r\nx;y;z", "a\rb;c\r\nd,e,f,g",
    "a;b\nc,d,e", "sin separador", "\n;;;", "a,\"b;c\",d",
  ];
  const particiones = [
    ["a;b;c", ";"], ["a;b;c", ","], ['"a;b";c', ";"], ['x"y;z', ";"], ['  "a"  ;b', ";"], ['"a"b;c', ";"], ['"a""b";c', ";"],
    ['"abierta;c\nd', ";"], ["a\r\nb\rc\n", ";"], ["﻿﻿a;b", ";"], ["a;;b;", ";"], [";;", ";"], ["a😀b", "😀"], ["a|b", "|"],
    ["a;b", ";;"], [" a ; b", ";"],
  ];
  const lineas = [["a;b;c", ";"], ["", ";"], ["\n\nx;y", ";"]];
  const filasCsv: Parameters<typeof precios.generarCsv>[0][] = [
    [],
    [{ sku: "FEN18", producto: "Fenólico 18 mm", medida: "2440 x 1220", categoria: "Placas", precioGeneral: "84500.50", precioProfesional: "80275.48" }],
    [
      { sku: "T;1", producto: 'Tirante 2" x 3"', medida: "3,05 m", categoria: "Maderas\nduras", precioGeneral: "1.2.3", precioProfesional: "" },
      { sku: "", producto: "", medida: "", categoria: "", precioGeneral: "", precioProfesional: "100" },
      { sku: "CR", producto: "con\rretorno", medida: "a,b", categoria: '"', precioGeneral: "5", precioProfesional: "-0.00" },
    ],
  ];

  const sueltos = {
    columnas: precios.COLUMNAS,
    numeros: numeros.map((t) => ({ t, r: csv.interpretarNumero(t) })),
    precios: numeros.map((t) => ({ t, r: precios.interpretarPrecio(t) })),
    encabezados: encabezados.map((t) => ({ t, r: csv.normalizarEncabezado(t) })),
    separadores: separadores.map((t) => ({ t, r: csv.detectarSeparador(t) })),
    particiones: particiones.map(([t, sep]) => ({ t, sep, r: csv.partirPlanilla(t, sep) })),
    lineas: lineas.map(([t, sep]) => ({ t, sep, r: csv.partirLinea(t, sep) })),
    csv: filasCsv.map((filas) => ({ filas, r: precios.generarCsv(filas) })),
    grillas: [
      [],
      [[]],
      [["", " "], ["SKU", "Precio"], ["X", "1"]],
      [["sku", "lista", "profesional"], ["A"], ["B", "1"], ["C", "", "2"], ["  ", "3", "4"], ["D", "-1", "(2)"]],
      [["precio", "SKU"], ["1,5", "A"]],
      [["Precio lista", "Precio", "SKU"], ["1", "2", "S"]],
    ].map((grilla) => ({ grilla, r: precios.leerFilas(grilla) })),
  };

  writeFileSync(new URL("archivos.json", DESTINO), JSON.stringify(archivos, null, 1) + "\n");
  // Las variantes y los deflate van comprimidos: son varios megas de base64.
  writeFileSync(new URL("variantes.json.gz", DESTINO), gzipSync(JSON.stringify(variantes) + "\n", { level: 9 }));
  writeFileSync(new URL("inflar.json.gz", DESTINO), gzipSync(JSON.stringify(inflados) + "\n", { level: 9 }));
  writeFileSync(new URL("sueltos.json", DESTINO), JSON.stringify(sueltos, null, 1) + "\n");

  const errores = new Map<string, number>();
  for (const v of [...archivos, ...variantes]) {
    const e = v.leida.error ?? "(sin error)";
    errores.set(e.slice(0, 70), (errores.get(e.slice(0, 70)) ?? 0) + 1);
  }
  const casos =
    archivos.length + variantes.length + inflados.length + sueltos.numeros.length * 2 + sueltos.encabezados.length +
    sueltos.separadores.length + sueltos.particiones.length + sueltos.lineas.length + sueltos.csv.length + sueltos.grillas.length;
  console.log(`${archivos.length} archivos, ${variantes.length} variantes, ${inflados.length} deflate; ${casos} casos en total`);
  console.log([...errores].sort((a, b) => b[1] - a[1]).map(([e, n]) => `  ${n}\t${e}`).join("\n"));
}

main();
