/**
 * El lado TypeScript del benchmark de la tanda 11: el plano de corte **como
 * era antes de la mudanza** (lib/cortes/plano.ts de 9a17128, copiado en
 * ts/), servido por node:http con `calcularPlanoDeCorteSinTrabar`, que es lo
 * que corría en el servidor de Next. Ver README.md.
 *
 *   npx tsx --tsconfig tsconfig.json bench/tanda11/ts-servidor.ts   # :8391
 *   npx tsx --tsconfig tsconfig.json bench/tanda11/ts-servidor.ts despieces   # escribe despieces.json
 */
import { createServer } from "node:http";
import { writeFileSync } from "node:fs";
import { calcularPlanoDeCorteSinTrabar } from "./ts/plano";
import { despiecesDePrueba } from "./ts/benchmark-plano";

if (process.argv[2] === "despieces") {
  const d = despiecesDePrueba().map((x) => ({
    ...x,
    anchoSierra: 5,
    piezas: x.piezas.map((p) => ({ ...p, etiqueta: null })),
  }));
  writeFileSync(new URL("despieces.json", import.meta.url), JSON.stringify(d));
  process.exit(0);
}

createServer((req, res) => {
  if (req.url === "/salud") return res.end("ok");
  if (req.url !== "/plano" || req.method !== "POST") {
    res.writeHead(404);
    return res.end();
  }
  let cuerpo = "";
  req.on("data", (c) => (cuerpo += c));
  req.on("end", async () => {
    try {
      const plano = await calcularPlanoDeCorteSinTrabar(JSON.parse(cuerpo));
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ plano }));
    } catch (e) {
      res.writeHead(500);
      res.end(String(e));
    }
  });
}).listen(8391, () => console.log("ts-servidor en :8391"));
