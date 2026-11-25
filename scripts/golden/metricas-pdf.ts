/**
 * Genera backend/internal/pdf/metricas.gen.go con las métricas de las fuentes
 * estándar tal como las usa pdf-lib (@pdf-lib/standard-fonts): el ancho de
 * cada glifo y los pares de kerning, ya traducidos a los códigos de WinAnsi.
 *
 * pdf-lib mide un texto sumando el ancho de cada glifo **más el kerning del
 * par** (aunque al dibujar no lo aplica: escribe un Tj pelado). Para que los
 * cortes de línea y las alineaciones a la derecha den igual en Go, hay que
 * medir exactamente igual, así que las tablas salen de la misma fuente.
 *
 * Van las 12 fuentes que usan WinAnsi; Symbol y ZapfDingbats tienen su propia
 * codificación y ningún documento las usa.
 *
 *   npx tsx scripts/golden/metricas-pdf.ts && gofmt -w backend/internal/pdf/metricas.gen.go
 */
import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const requerir = createRequire(import.meta.url);
const { Font, Encodings } = requerir("@pdf-lib/standard-fonts") as typeof import("@pdf-lib/standard-fonts");
const version = (requerir("@pdf-lib/standard-fonts/package.json") as { version: string }).version;

const FUENTES = [
  ["Helvetica", "Helvetica"],
  ["HelveticaBold", "Helvetica-Bold"],
  ["HelveticaOblique", "Helvetica-Oblique"],
  ["HelveticaBoldOblique", "Helvetica-BoldOblique"],
  ["Courier", "Courier"],
  ["CourierBold", "Courier-Bold"],
  ["CourierOblique", "Courier-Oblique"],
  ["CourierBoldOblique", "Courier-BoldOblique"],
  ["TimesRoman", "Times-Roman"],
  ["TimesBold", "Times-Bold"],
  ["TimesItalic", "Times-Italic"],
  ["TimesBoldItalic", "Times-BoldItalic"],
] as const;

const winAnsi = Encodings.WinAnsi as unknown as { unicodeMappings: Record<number, [number, string]> };
const mapeo = Object.entries(winAnsi.unicodeMappings)
  .map(([u, [code, nombre]]) => ({ u: Number(u), code, nombre }))
  .sort((a, b) => a.u - b.u);

// El nombre del glifo de cada código (para medir por código en Go).
const nombreDe = new Map<number, string>();
for (const m of mapeo) nombreDe.set(m.code, m.nombre);

let go = `// Código generado por scripts/golden/metricas-pdf.ts desde
// @pdf-lib/standard-fonts ${version}. NO EDITAR: se regenera.

package pdf

// winAnsi traduce un punto de código Unicode al byte de WinAnsiEncoding,
// como Encodings.WinAnsi.encodeUnicodeCodePoint de pdf-lib.
var winAnsi = map[rune]byte{
`;
for (const m of mapeo) go += `\t0x${m.u.toString(16)}: 0x${m.code.toString(16)},\n`;
go += "}\n\n";

go += `// metricas guarda, por fuente, el ancho de cada código de WinAnsi (en
// milésimas de em; 250 si la fuente no tiene el glifo, como widthOfGlyph de
// pdf-lib) y el kerning de cada par de códigos (izquierdo<<8 | derecho).
var metricas = map[Fuente]*metrica{
`;
for (const [ident, nombre] of FUENTES) {
  const f = Font.load(nombre) as unknown as {
    getWidthOfGlyph(n: string): number | undefined;
    getXAxisKerningForPair(a: string, b: string): number | undefined;
  };
  const anchos: number[] = [];
  for (let c = 0; c < 256; c++) {
    const n = nombreDe.get(c);
    anchos.push(n ? f.getWidthOfGlyph(n) || 250 : 0);
  }
  const pares: [number, string][] = [];
  for (const [ca, na] of nombreDe) {
    for (const [cb, nb] of nombreDe) {
      const k = f.getXAxisKerningForPair(na, nb);
      if (k) pares.push([ca * 256 + cb, `0x${(ca * 256 + cb).toString(16).padStart(4, "0")}: ${k}`]);
    }
  }
  pares.sort((a, b) => a[0] - b[0]);
  go += `\t${ident}: {\n\t\tnombre: ${JSON.stringify(nombre)},\n\t\tancho: [256]int16{${anchos.join(", ")}},\n\t\tkern: map[uint16]int16{\n`;
  for (const [, p] of pares) go += `\t\t\t${p},\n`;
  go += "\t\t},\n\t},\n";
}
go += "}\n";

writeFileSync(new URL("../../backend/internal/pdf/metricas.gen.go", import.meta.url), go);
console.log("listo: backend/internal/pdf/metricas.gen.go");
