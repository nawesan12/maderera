/**
 * El lado TypeScript del benchmark de la tanda 2: el catálogo público **como
 * era antes de la mudanza** (el DAL de git c575c73^), servido por node:http.
 * Sin Next y sin su caché, como el lado Go: se compara el lenguaje y sus
 * librerías haciendo el mismo trabajo.
 *
 *   DATABASE_URL=postgres://… npx tsx --conditions=react-server bench/tanda2/ts-servidor.ts   # :8092
 */
import { createServer } from "node:http";

async function main() {
  const c = await import("./ts/catalogo");
  createServer(async (req, res) => {
    const u = new URL(req.url ?? "/", "http://x");
    try {
      let v: unknown;
      if (u.pathname === "/salud") return res.end("ok");
      if (u.pathname === "/pagina") {
        v = await c.paginaDeProductosPublica({ busqueda: u.searchParams.get("busqueda") ?? undefined }, Number(u.searchParams.get("pagina") ?? 1));
      } else if (u.pathname.startsWith("/ficha/")) {
        v = await c.obtenerProductoPublico(u.pathname.slice(7));
      } else if (u.pathname === "/categorias") {
        v = await c.listarCategorias();
      } else {
        res.writeHead(404);
        return res.end();
      }
      res.writeHead(v ? 200 : 404, { "content-type": "application/json" });
      res.end(JSON.stringify(v));
    } catch (e) {
      res.writeHead(500);
      res.end(String(e));
    }
  }).listen(8092, () => console.log("ts-servidor en :8092"));
}
main();
