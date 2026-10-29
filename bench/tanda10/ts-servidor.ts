/**
 * El lado TypeScript del benchmark de la tanda 10: el panel de campañas, el
 * alcance de un segmento, las solicitudes de profesionales, el panel de
 * eventos y el estado profesional de quien mira, **como eran antes de la
 * mudanza** (go-cuentas 56ef2a1), servidos por node:http, sin Next. Ver
 * README.md.
 *
 *   DATABASE_URL=…/bench_t10 DATABASE_POOL_MAX=20 BENCH_USUARIO=<admin> BENCH_CLIENTE=<cuenta web> \
 *     npx tsx --tsconfig tsconfig.json --conditions=react-server bench/tanda10/ts-servidor.ts   # :8310
 */
import { createServer } from "node:http";

async function main() {
  const campanas = await import("./ts/admin-campanas");
  const envio = await import("./ts/campanas/envio");
  const profesionales = await import("./ts/admin-profesionales");
  const eventos = await import("./ts/admin-eventos");
  const portal = await import("./ts/profesionales");
  createServer(async (req, res) => {
    const u = new URL(req.url ?? "/", "http://x");
    try {
      let v: unknown;
      switch (u.pathname) {
        case "/salud":
          return res.end("ok");
        case "/campanas": {
          // Lo que hacía la página: la lista y las bajas.
          const [lista, bajas] = await Promise.all([campanas.listarCampanas(), campanas.cantidadDeBajas()]);
          v = { lista, bajas };
          break;
        }
        case "/alcance":
          v = await envio.contarDestinatarios({ tipo: "profesional", rubros: ["carpintero", "arquitecto"], actividad: null });
          break;
        case "/solicitudes": {
          const [s, l, r] = await Promise.all([
            profesionales.listarSolicitudes(),
            profesionales.listasAsignables(),
            profesionales.resumenProfesionales(),
          ]);
          v = { s, l, r };
          break;
        }
        case "/eventos":
          v = await eventos.listarEventos();
          break;
        case "/estado":
          v = await portal.estadoProfesional();
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
  }).listen(8310, () => console.log("ts-servidor en :8310"));
}
main();
