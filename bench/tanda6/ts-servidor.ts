/**
 * El lado TypeScript del benchmark de la tanda 6, **como era antes de la
 * mudanza** (git 791cc3f), servido por node:http sin Next. Ver README.md.
 *
 *   DATABASE_URL=…/bench_t6 DATABASE_POOL_MAX=20 MP_WEBHOOK_SECRET=… \
 *     npx tsx --tsconfig tsconfig.json --conditions=react-server bench/tanda6/ts-servidor.ts   # :8306
 *
 * - /agregar y /confirmar: el carrito por token y confirmarCompra (ts/compra.ts).
 * - /api/pagos/webhook: la ruta de antes (firma, a la cola, 200). El
 *   procesamiento (`after(procesarCola)`) no se corre: en los dos lados se
 *   mide lo que tarda en aceptar el aviso.
 * - /pagos: lo que pedía la conciliación (listarPagos, resumenPagos y
 *   ultimosAvisos del mes, de lib/dal/admin/pagos.ts de entonces).
 */
import { createServer, type IncomingMessage } from "node:http";

function leer(req: IncomingMessage): Promise<string> {
  return new Promise((ok) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => ok(b));
  });
}

async function main() {
  const compra = await import("./ts/compra");
  const panel = await import("./ts/pagos-panel");
  const { firmaValida, leerCabeceraFirma } = await import("@/scripts/golden/originales/tanda6/firma");
  const { db } = await import("@/lib/db");
  const { trabajos } = await import("@/lib/db/schema");
  const { resolverPeriodo } = await import("@/lib/periodos");
  createServer(async (req, res) => {
    const u = new URL(req.url ?? "/", "http://x");
    try {
      let v: unknown;
      switch (u.pathname) {
        case "/salud":
          return res.end("ok");
        case "/agregar": {
          const d = JSON.parse(await leer(req));
          v = await compra.agregar(d.token, d.variantId, d.cantidad);
          break;
        }
        case "/confirmar": {
          const d = JSON.parse(await leer(req));
          v = await compra.confirmar(d.token, d, String(req.headers["x-forwarded-for"] ?? "sin-ip"));
          break;
        }
        case "/api/pagos/webhook": {
          // app/api/pagos/webhook/route.ts de 791cc3f, sin el after().
          const crudo = await leer(req);
          let cuerpo: unknown = {};
          try {
            cuerpo = crudo ? JSON.parse(crudo) : {};
          } catch {
            v = { ok: true };
            break;
          }
          const cabecera = leerCabeceraFirma((req.headers["x-signature"] as string) ?? null);
          const dataId =
            u.searchParams.get("data.id") ??
            (typeof (cuerpo as { data?: { id?: unknown } })?.data?.id !== "undefined"
              ? String((cuerpo as { data: { id: unknown } }).data.id)
              : null);
          const verificada = cabecera
            ? firmaValida(
                { dataId: dataId ? dataId.toLowerCase() : null, requestId: (req.headers["x-request-id"] as string) ?? null, ts: cabecera.ts, v1: cabecera.v1 },
                process.env.MP_WEBHOOK_SECRET,
              )
            : false;
          await db
            .insert(trabajos)
            .values({ tipo: "pago.aviso", carga: { proveedor: "mercado_pago", cuerpo, url: `https://x${req.url}`, firmaVerificada: verificada } })
            .returning({ id: trabajos.id });
          v = { ok: true };
          break;
        }
        case "/pagos": {
          const periodo = resolverPeriodo("mes");
          const [pagos, resumen, avisos, banco] = await Promise.all([
            panel.listarPagos(periodo.desde ? { desde: periodo.desde } : {}),
            panel.resumenPagos(periodo),
            panel.ultimosAvisos(8),
            panel.obtenerDatosBancarios(),
          ]);
          v = { pagos, resumen, avisos, banco };
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
  }).listen(8306, () => console.log("ts-servidor en :8306"));
}

void main();
