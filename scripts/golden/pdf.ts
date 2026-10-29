/**
 * Golden de los PDF (lib/pdf/**): corre cada generador de TS con datos de
 * ejemplo —largos, con cortes de página, tildes, montos grandes, muchos
 * renglones— y guarda, por cada caso, los datos de entrada y el PDF que sale:
 *
 *   backend/testdata/golden/pdf/<documento>/<caso>.json   { ahora, datos }
 *   backend/testdata/golden/pdf/<documento>/<caso>.pdf
 *
 * Go (internal/pdf, golden_test.go) arma el mismo documento con los mismos
 * datos y compara los dos rasterizados con pdftoppm y los textos con
 * pdftotext.
 *
 * Los casos de cada documento están en scripts/golden/pdf/<documento>.ts (un
 * archivo por documento, así se suman sin pisarse). El reloj queda quieto
 * en AHORA y la zona en la de Argentina: los documentos escriben «hoy».
 *
 *   npx tsx scripts/golden/pdf.ts            todos
 *   npx tsx scripts/golden/pdf.ts remito     uno solo
 */
process.env.TZ = "America/Argentina/Buenos_Aires";

import { createRequire } from "node:module";
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// lib/pdf importa "server-only", que fuera de Next tira un error.
const requerir = createRequire(import.meta.url);
const rutaServerOnly = requerir.resolve("server-only");
requerir.cache[rutaServerOnly] = {
  id: rutaServerOnly,
  filename: rutaServerOnly,
  loaded: true,
  exports: {},
} as never;

// El reloj quieto: 5/3/2026 a las 12:04:05 de Argentina (15:04 UTC), una hora
// en la que la fecha da igual en cualquier zona.
export const AHORA = "2026-03-05T15:04:05.000Z";
const msAhora = Date.parse(AHORA);
const DateReal = Date;
class DateQuieto extends DateReal {
  constructor(...args: unknown[]) {
    if (args.length === 0) super(msAhora);
    else super(...(args as [string]));
  }
  static now() {
    return msAhora;
  }
}
globalThis.Date = DateQuieto as DateConstructor;

export interface CasoPdf {
  nombre: string;
  /** La entrada tal cual la recibe el generador (Go la lee con la misma forma). */
  datos: unknown;
  generar: () => Promise<Uint8Array>;
}

const aqui = path.dirname(fileURLToPath(import.meta.url));
const DESTINO = path.join(aqui, "../../backend/testdata/golden/pdf");

async function main() {
  const solo = process.argv[2];
  const documentos = readdirSync(path.join(aqui, "pdf"))
    .filter((f) => f.endsWith(".ts") && !f.startsWith("_"))
    .map((f) => f.replace(/\.ts$/, ""))
    .filter((d) => !solo || d === solo)
    .sort();

  for (const doc of documentos) {
    const { casos } = (await import(path.join(aqui, "pdf", `${doc}.ts`))) as { casos: CasoPdf[] };
    const dir = path.join(DESTINO, doc);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    for (const caso of casos) {
      const pdf = await caso.generar();
      writeFileSync(path.join(dir, `${caso.nombre}.pdf`), pdf);
      writeFileSync(
        path.join(dir, `${caso.nombre}.json`),
        JSON.stringify({ ahora: AHORA, datos: caso.datos }) + "\n",
      );
    }
    console.log(`${doc}: ${casos.length} casos`);
  }
  if (!solo) escribirFormatos();
}

/**
 * Los formatos de lib/formato.ts que usan los documentos, contra Intl de
 * Node (backend/internal/pdf/formato_test.go).
 */
function escribirFormatos() {
  const { moneda, fechaSolaCorta, fechaHora } = requerir("../../lib/formato") as typeof import("../../lib/formato");
  const importes = [0, -0, 1, -1, 0.5, -0.5, 1.5, 2.5, -2.5, 0.49999999999999994, 999.5, 1234.5, -1234.5, 1e6, 123456789.49,
    9007199254740993, 1e15 + 0.5, 1e20, 99999999999.99, -0.4, 0.001, NaN, Infinity, -Infinity];
  for (let i = 0; i < 300; i++) importes.push(Math.round((Math.sin(i) * 10 ** (i % 12)) * 100) / 100);
  const instantes = ["2026-03-05T15:04:05.000Z", "2026-01-01T02:59:59.999Z", "2026-01-01T03:00:00.000Z", "2025-12-31T23:30:00.000Z",
    "1999-07-09T00:00:00.000Z", "2030-11-30T21:15:00.000Z", "2026-10-29T12:00:00.000Z"];
  for (let i = 0; i < 100; i++) instantes.push(new DateReal(1.6e12 + i * 7.77e8).toISOString());
  const salida = {
    moneda: importes.map((v) => ({ v: Object.is(v, -0) ? "-0" : Number.isFinite(v) ? v : String(v), s: moneda.format(v) })),
    fechas: instantes.map((iso) => {
      const d = new DateReal(iso);
      return { iso, local: d.toLocaleDateString("es-AR"), solaCorta: fechaSolaCorta.format(d), fechaHora: fechaHora.format(d) };
    }),
  };
  writeFileSync(path.join(DESTINO, "formato.json"), JSON.stringify(salida) + "\n");
  console.log(`formato: ${importes.length} importes, ${instantes.length} fechas`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
