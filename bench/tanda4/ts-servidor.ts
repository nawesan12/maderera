/**
 * El lado TypeScript del benchmark de la tanda 4: la cartera de clientes,
 * el historial, los cheques y el cobro con recibo **como eran antes de la
 * mudanza** (git 398454c), servidos por node:http, sin Next. Ver README.md.
 *
 *   DATABASE_URL=…/bench_t4 DATABASE_POOL_MAX=20 BENCH_USUARIO=<id del admin> \
 *     npx tsx --tsconfig tsconfig.json --conditions=react-server bench/tanda4/ts-servidor.ts   # :8094
 */
import { createServer } from "node:http";

async function main() {
  const clientes = await import("./ts/admin-clientes");
  const cobranza = await import("./ts/admin-cobranza");
  const historial = await import("./ts/historial-cliente");
  const cheques = await import("./ts/admin-cheques");
  const { db } = await import("@/lib/db");
  const { emitirRecibo } = await import("@/scripts/golden/originales/tanda6/recibo");
  createServer(async (req, res) => {
    const u = new URL(req.url ?? "/", "http://x");
    try {
      let v: unknown;
      switch (u.pathname) {
        case "/salud":
          return res.end("ok");
        case "/clientes": {
          // Lo que hacía la página: el listado y después la deuda de los que deben.
          const lista = await clientes.listarClientes({ busqueda: u.searchParams.get("busqueda") ?? undefined });
          const deudas = await cobranza.deudaPorCliente(
            lista.filter((c) => c.saldo > 0).map((c) => ({ id: c.id, diasCredito: c.diasCredito, cuentaBloqueada: c.cuentaBloqueada })),
          );
          v = lista.map((c) => ({ ...c, deuda: deudas.get(c.id) ?? null }));
          break;
        }
        case "/historial": {
          const id = u.searchParams.get("id") ?? "";
          const [h, saldo] = await Promise.all([
            historial.historialDelCliente(id, { desde: historial.desdeDelPeriodo("12m") }),
            historial.saldoDelCliente(id),
          ]);
          v = { ...h, saldo };
          break;
        }
        case "/cheques":
          v = await cheques.listarCheques({});
          break;
        case "/cobro": {
          const id = u.searchParams.get("id") ?? "";
          v = await db.transaction((tx) =>
            emitirRecibo(tx, { customerId: id, origen: "panel", partes: [{ medio: "transferencia", importe: 1 }], usuarioId: process.env.BENCH_USUARIO }),
          );
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
  }).listen(8094, () => console.log("ts-servidor en :8094"));
}
main();
