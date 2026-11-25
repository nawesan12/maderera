/**
 * El lado TS del benchmark de la tanda 12: sirve GET /<documento>/<caso>
 * armando el PDF con el generador de lib/pdf (pdf-lib) y los mismos datos de
 * los golden (scripts/golden/pdf/<documento>.ts). Los datos ya están armados
 * en memoria: solo se mide el PDF.
 *
 *   PDF_GOLDEN_SOLO_LEER=1 npx tsx bench/tanda12/ts-servidor.ts   # :8392
 */
process.env.TZ = "America/Argentina/Buenos_Aires";
process.env.PDF_GOLDEN_SOLO_LEER = "1";

import { createRequire } from "node:module";
import { createServer } from "node:http";
import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const requerir = createRequire(import.meta.url);
const rutaServerOnly = requerir.resolve("server-only");
requerir.cache[rutaServerOnly] = { id: rutaServerOnly, filename: rutaServerOnly, loaded: true, exports: {} } as never;

interface Caso {
  nombre: string;
  generar: () => Promise<Uint8Array>;
}

const aqui = path.dirname(fileURLToPath(import.meta.url));
const dirCasos = path.join(aqui, "../../scripts/golden/pdf");
const PUERTO = Number(process.env.PUERTO ?? 8392);

async function main() {
  const casos = new Map<string, Caso>();
  for (const f of readdirSync(dirCasos).filter((f) => f.endsWith(".ts") && !f.startsWith("_"))) {
    const doc = f.replace(/\.ts$/, "");
    const m = (await import(path.join(dirCasos, f))) as { casos: Caso[] };
    for (const c of m.casos) casos.set(`${doc}/${c.nombre}`, c);
  }
  createServer(async (req, res) => {
    const caso = casos.get((req.url ?? "").replace(/^\/+|\/+$/g, ""));
    if (!caso) {
      res.writeHead(404).end();
      return;
    }
    try {
      const pdf = await caso.generar();
      res.writeHead(200, { "Content-Type": "application/pdf" }).end(pdf);
    } catch (e) {
      res.writeHead(500).end(String(e));
    }
  }).listen(PUERTO, "127.0.0.1", () => console.log(`benchmark de PDF (TS) en :${PUERTO}, ${casos.size} casos`));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
