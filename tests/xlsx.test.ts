import { describe, expect, it } from "vitest";
import { deflateRawSync, crc32 } from "node:zlib";
import { leerXlsx } from "@/lib/xlsx";

/**
 * Los tests arman un .xlsx de verdad, byte por byte.
 *
 * Es más trabajo que cargar un archivo de ejemplo, pero deja ver qué se está
 * probando: cada caso dice explícitamente qué guarda Excel para esa celda. Un
 * binario opaco en la carpeta de tests no explica por qué la fecha estaba
 * corrida un día.
 */

/** Arma un ZIP con los archivos dados. Deflate para todos. */
function armarZip(archivos: Record<string, string>): Uint8Array {
  const entradas: {
    nombre: Uint8Array;
    datos: Uint8Array;
    crudo: Uint8Array;
    offset: number;
  }[] = [];
  const partes: Uint8Array[] = [];
  let offset = 0;

  for (const [nombre, contenido] of Object.entries(archivos)) {
    const nombreBytes = new TextEncoder().encode(nombre);
    const crudo = new TextEncoder().encode(contenido);
    const datos = new Uint8Array(deflateRawSync(crudo));

    const local = new Uint8Array(30 + nombreBytes.length);
    const v = new DataView(local.buffer);
    v.setUint32(0, 0x04034b50, true);
    v.setUint16(4, 20, true);
    v.setUint16(8, 8, true); // deflate
    v.setUint32(14, crc32(Buffer.from(crudo)), true);
    v.setUint32(18, datos.length, true);
    v.setUint32(22, crudo.length, true);
    v.setUint16(26, nombreBytes.length, true);
    local.set(nombreBytes, 30);

    entradas.push({ nombre: nombreBytes, datos, crudo, offset });
    partes.push(local, datos);
    offset += local.length + datos.length;
  }

  const inicioCentral = offset;
  for (const entrada of entradas) {
    const central = new Uint8Array(46 + entrada.nombre.length);
    const v = new DataView(central.buffer);
    v.setUint32(0, 0x02014b50, true);
    v.setUint16(10, 8, true);
    v.setUint32(16, crc32(Buffer.from(entrada.crudo)), true);
    v.setUint32(20, entrada.datos.length, true);
    v.setUint32(24, entrada.crudo.length, true);
    v.setUint16(28, entrada.nombre.length, true);
    v.setUint32(42, entrada.offset, true);
    central.set(entrada.nombre, 46);
    partes.push(central);
    offset += central.length;
  }

  const fin = new Uint8Array(22);
  const vf = new DataView(fin.buffer);
  vf.setUint32(0, 0x06054b50, true);
  vf.setUint16(8, entradas.length, true);
  vf.setUint16(10, entradas.length, true);
  vf.setUint32(12, offset - inicioCentral, true);
  vf.setUint32(16, inicioCentral, true);
  partes.push(fin);

  const total = partes.reduce((s, p) => s + p.length, 0);
  const salida = new Uint8Array(total);
  let cursor = 0;
  for (const parte of partes) {
    salida.set(parte, cursor);
    cursor += parte.length;
  }
  return salida;
}

const LIBRO = `<?xml version="1.0"?><workbook><sheets><sheet name="Articulos" sheetId="1"/></sheets></workbook>`;

function planilla(opciones: {
  hoja: string;
  compartidos?: string[];
  estilos?: string;
}): Uint8Array {
  const archivos: Record<string, string> = {
    "xl/workbook.xml": LIBRO,
    "xl/worksheets/sheet1.xml": `<?xml version="1.0"?><worksheet><sheetData>${opciones.hoja}</sheetData></worksheet>`,
  };
  if (opciones.compartidos) {
    archivos["xl/sharedStrings.xml"] =
      `<?xml version="1.0"?><sst>${opciones.compartidos.map((t) => `<si><t>${t}</t></si>`).join("")}</sst>`;
  }
  if (opciones.estilos) archivos["xl/styles.xml"] = opciones.estilos;
  return armarZip(archivos);
}

describe("leerXlsx", () => {
  it("lee una grilla con textos compartidos", () => {
    const bytes = planilla({
      compartidos: ["Codigo", "Descripcion", "MDF 18mm"],
      hoja: `
        <row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>
        <row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>1830</v></c></row>`,
    });

    const { filas, hoja } = leerXlsx(bytes);
    expect(hoja).toBe("Articulos");
    expect(filas).toEqual([
      ["Codigo", "Descripcion"],
      ["MDF 18mm", "1830"],
    ]);
  });

  it("rellena las columnas que Excel no escribe", () => {
    // Una fila que empieza en C tiene dos celdas vacías adelante. Si se
    // leyeran por orden de aparición, todas las columnas quedarían corridas.
    const bytes = planilla({
      hoja: `<row r="1"><c r="C1"><v>7</v></c><c r="E1"><v>9</v></c></row>`,
    });

    expect(leerXlsx(bytes).filas).toEqual([["", "", "7", "", "9"]]);
  });

  it("convierte a fecha las celdas con formato de fecha", () => {
    // El estilo 1 apunta a numFmtId 14, que es la fecha corta de Excel.
    const estilos = `<?xml version="1.0"?><styleSheet><cellXfs>
      <xf numFmtId="0"/><xf numFmtId="14"/>
    </cellXfs></styleSheet>`;

    const bytes = planilla({
      estilos,
      // 46269 es el 3 de septiembre de 2026. El mismo número sin formato de
      // fecha tiene que quedar como número.
      hoja: `<row r="1"><c r="A1" s="1"><v>46269</v></c><c r="B1" s="0"><v>46269</v></c></row>`,
    });

    const [fila] = leerXlsx(bytes).filas;
    expect(fila[0].slice(0, 10)).toBe("2026-09-03");
    expect(fila[1]).toBe("46269");
  });

  it("reconoce los formatos de fecha personalizados", () => {
    const estilos = `<?xml version="1.0"?><styleSheet>
      <numFmts><numFmt numFmtId="164" formatCode="dd/mm/yyyy"/></numFmts>
      <cellXfs><xf numFmtId="164"/></cellXfs>
    </styleSheet>`;

    const bytes = planilla({
      estilos,
      hoja: `<row r="1"><c r="A1" s="0"><v>46269</v></c></row>`,
    });

    expect(leerXlsx(bytes).filas[0][0].slice(0, 10)).toBe("2026-09-03");
  });

  it("no toca los códigos que parecen números", () => {
    // Un código de artículo "007" que se vuelve 7 no encuentra su producto.
    const bytes = planilla({
      compartidos: ["007", "30589445259"],
      hoja: `<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>`,
    });

    expect(leerXlsx(bytes).filas[0]).toEqual(["007", "30589445259"]);
  });

  it("lee el texto escrito dentro de la celda", () => {
    const bytes = planilla({
      hoja: `<row r="1"><c r="A1" t="inlineStr"><is><t>Pino 2" x 4"</t></is></c></row>`,
    });

    expect(leerXlsx(bytes).filas[0][0]).toBe('Pino 2" x 4"');
  });

  it("descarta las filas vacías del final", () => {
    const bytes = planilla({
      compartidos: ["Dato"],
      hoja: `
        <row r="1"><c r="A1" t="s"><v>0</v></c></row>
        <row r="2"><c r="A2"/></row>
        <row r="3"><c r="A3"/></row>`,
    });

    expect(leerXlsx(bytes).filas).toHaveLength(1);
  });

  it("avisa cuando el archivo no es un zip", () => {
    expect(() => leerXlsx(new TextEncoder().encode("no soy un xlsx"))).toThrow(
      /no es un \.xlsx válido/,
    );
  });
});
