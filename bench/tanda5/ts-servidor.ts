/**
 * El lado TypeScript del benchmark de la tanda 5: la venta del mostrador, la
 * búsqueda, el listado de pedidos y la descarga de la cola **como eran antes
 * de la mudanza** (git 56ef2a1, copiados en ./ts), servidos por node:http,
 * sin Next. Ver README.md.
 *
 *   DATABASE_URL=…/bench_t5 DATABASE_POOL_MAX=20 BENCH_USUARIO=<id del admin> API_URL=http://127.0.0.1:8205 \
 *     npx tsx --tsconfig tsconfig.json --conditions=react-server bench/tanda5/ts-servidor.ts   # :8305
 */
import { createServer, type IncomingMessage } from "node:http";

function leer(req: IncomingMessage): Promise<unknown> {
  return new Promise((ok) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => {
      try {
        ok(JSON.parse(b));
      } catch {
        ok(null);
      }
    });
  });
}

async function main() {
  const venta = await import("./ts/venta");
  const buscar = await import("./ts/buscar");
  const ventas = await import("./ts/ventas");
  const usuario = process.env.BENCH_USUARIO ?? "";
  type Venta = Parameters<typeof venta.registrarVentaDeMostrador>[0];
  createServer(async (req, res) => {
    const u = new URL(req.url ?? "/", "http://x");
    try {
      let v: unknown;
      switch (u.pathname) {
        case "/salud":
          return res.end("ok");
        case "/venta": {
          const d = (await leer(req)) as Venta;
          v = await venta.registrarVentaDeMostrador({ ...d, usuarioId: usuario, cobradaAt: null, numeroProvisorio: null });
          break;
        }
        case "/descarga": {
          // Lo que hacía POST /api/mostrador/ventas: una por una, en orden.
          const d = (await leer(req)) as { ventas: (Venta & { cobradaAt: string })[] };
          const resultados = [];
          for (const x of d.ventas) {
            const r = await venta.registrarVentaDeMostrador({
              ...x,
              usuarioId: usuario,
              cobradaAt: new Date(x.cobradaAt),
              autorizado: true,
            });
            resultados.push(
              r.ok
                ? { clave: x.clave, estado: "sincronizada", numero: r.numero, orderId: r.orderId, nueva: r.nueva }
                : { clave: x.clave, estado: "rechazada", motivo: r.error },
            );
          }
          v = { resultados, servidorAt: new Date().toISOString() };
          break;
        }
        case "/buscar":
          v = await buscar.buscarParaMostrador(u.searchParams.get("q") ?? "", u.searchParams.get("sucursal") ?? "", null);
          break;
        case "/pedidos":
          v = await ventas.listarPedidos({});
          break;
        default:
          res.writeHead(404);
          return res.end();
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(v));
    } catch (e) {
      res.writeHead(500);
      res.end(String(e));
    }
  }).listen(8305, () => console.log("ts-servidor en :8305"));
}
main();
