/**
 * El lado TypeScript del benchmark de la tanda 3: el panel de productos,
 * precios y stock **como era antes de la mudanza** (git dcdb751), servido por
 * node:http, sin Next. Ver README.md.
 *
 *   DATABASE_URL=… BENCH_USUARIO=<id del admin> npx tsx --tsconfig tsconfig.json --conditions=react-server bench/tanda3/ts-servidor.ts   # :8093
 */
import { createServer } from "node:http";

async function main() {
  const productos = await import("./ts/admin-products");
  const precios = await import("./ts/admin-precios");
  const stock = await import("./ts/admin-inventory");
  const acciones = await import("./ts/precios-actions");
  createServer(async (req, res) => {
    const u = new URL(req.url ?? "/", "http://x");
    try {
      let v: unknown;
      switch (u.pathname) {
        case "/salud":
          return res.end("ok");
        case "/productos":
          v = await productos.listarProductosAdmin({ busqueda: u.searchParams.get("busqueda") ?? undefined });
          break;
        case "/precios":
          v = await precios.listarPrecios({ busqueda: u.searchParams.get("busqueda") ?? undefined });
          break;
        case "/stock":
          v = await stock.listarStock({ busqueda: u.searchParams.get("busqueda") ?? undefined });
          break;
        case "/ajuste": {
          const f = new FormData();
          f.set("porcentaje", u.searchParams.get("porcentaje") ?? "1");
          f.set("listaSlug", "ambas");
          v = await acciones.ajustarPrecios({}, f);
          break;
        }
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
  }).listen(8093, () => console.log("ts-servidor en :8093"));
}
main();
