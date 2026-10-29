/**
 * El lado TypeScript del benchmark de la tanda 13: la migración **como era
 * antes de la mudanza** (commit 56ef2a1, en ./ts), servida por node:http sin
 * Next, en las mismas rutas que la API de Go para que el mismo cliente
 * (medir.ts) le pegue a los dos. La sesión está stubeada (BENCH_USUARIO).
 *
 *   TZ=UTC DATABASE_URL=… DATABASE_POOL_MAX=20 BENCH_USUARIO=<id del admin> \
 *     npx tsx --tsconfig tsconfig.json --conditions=react-server bench/tanda13/ts-servidor.ts   # :8313
 */
import { createServer, type IncomingMessage } from "node:http";

async function cuerpo(req: IncomingMessage): Promise<Buffer> {
  const partes: Buffer[] = [];
  for await (const p of req) partes.push(p as Buffer);
  return Buffer.concat(partes);
}

async function main() {
  const acciones = await import("./ts/actions");
  const base = "/api/v1/admin/migracion/";

  createServer(async (req, res) => {
    const ruta = new URL(req.url ?? "/", "http://x").pathname;
    try {
      let v: unknown;
      const datos = await cuerpo(req);
      const json = () => JSON.parse(datos.toString("utf8"));
      const corrida = /^\/api\/v1\/admin\/migracion\/corridas\/([^/]+)\/(lote|cerrar)$/.exec(ruta);

      if (ruta === "/salud") {
        return res.end("ok");
      } else if (ruta === base + "analizar") {
        // El multipart, leído como lo lee Next para la acción.
        const formulario = await new Request("http://x", {
          method: "POST",
          headers: { "content-type": req.headers["content-type"] ?? "" },
          body: new Uint8Array(datos),
        }).formData();
        const entidad = String(formulario.get("entidad")) as never;
        formulario.delete("entidad");
        v = await acciones.analizarArchivo(entidad, formulario);
      } else if (ruta === base + "previa") {
        const b = json();
        v = await acciones.previsualizar(b.entidad, b.mapeo, b.filas);
      } else if (ruta === base + "corridas" && req.method === "POST") {
        const { entidad, ...resto } = json();
        v = await acciones.iniciarCorrida(entidad, resto);
      } else if (corrida) {
        const b = json();
        v =
          corrida[2] === "lote"
            ? await acciones.ejecutarLote(corrida[1], b.entidad, b.mapeo, b.filas)
            : await acciones.cerrarCorrida(corrida[1], b.entidad, b.mapeo, b.filas);
      } else {
        res.writeHead(404);
        return res.end();
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(v));
    } catch (e) {
      res.writeHead(500);
      res.end(String(e));
    }
  }).listen(Number(process.env.PUERTO ?? 8313), "127.0.0.1");
}

main();
