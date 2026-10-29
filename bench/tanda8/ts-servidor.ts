/**
 * El lado TypeScript del benchmark de la tanda 8: compras **como era antes de
 * la mudanza** (commit 9a17128), servido por node:http, sin Next. Ver README.md.
 *
 *   DATABASE_URL=… DATABASE_POOL_MAX=20 BENCH_USUARIO=<id del admin> \
 *     npx tsx --tsconfig tsconfig.json --conditions=react-server bench/tanda8/ts-servidor.ts   # :8388
 */
import { createServer } from "node:http";

async function main() {
  const proveedores = await import("./ts/proveedores");
  const pagos = await import("./ts/pagos-proveedor");
  const fiscal = await import("./ts/compras-fiscal");
  const pago = await import("./ts/pago");
  const csv = await import("../../lib/csv-excel");
  const comprobantes = await import("../../lib/fiscal/comprobantes-compra");
  const { leerPeriodoMensual } = await import("../../lib/periodos");
  createServer(async (req, res) => {
    const u = new URL(req.url ?? "/", "http://x");
    try {
      let v: unknown;
      switch (u.pathname) {
        case "/salud":
          return res.end("ok");
        case "/proveedores":
          v = await proveedores.listarProveedores({ busqueda: u.searchParams.get("busqueda") ?? undefined });
          break;
        case "/ficha":
          v = await proveedores.obtenerProveedor(u.searchParams.get("id") ?? "");
          break;
        case "/pagos":
          v = await pagos.listarPagosAProveedores();
          break;
        case "/libro": {
          // Copia de app/admin/arca/libro-iva-compras/exportar/route.ts (commit 9a17128).
          const periodo = leerPeriodoMensual(u.searchParams.get("periodo"), new Date());
          const libro = await fiscal.libroIvaCompras(periodo.desde, periodo.hasta);
          const filas = libro.filas.map((f) => [
            csv.fechaCsv(f.fechaEmision), csv.textoCsv(comprobantes.nombreComprobanteCompra(f.tipo)),
            csv.textoCsv(comprobantes.numeroDeCompra(f.puntoVenta, f.numero)), csv.textoCsv(f.proveedor), csv.textoCsv(f.cuit),
            csv.numeroCsv(f.neto), csv.numeroCsv(f.iva21), csv.numeroCsv(f.iva105), csv.numeroCsv(f.iva27), csv.numeroCsv(f.exento),
            csv.numeroCsv(f.percepciones), csv.numeroCsv(f.total), csv.textoCsv(comprobantes.daCreditoFiscal(f.tipo) ? "Sí" : "No"), csv.textoCsv(f.cae),
          ]);
          const computable = libro.filas.filter((f) => comprobantes.daCreditoFiscal(f.tipo)).reduce((s, f) => s + f.iva21 + f.iva105 + f.iva27, 0);
          const t = libro.totales;
          const cuerpo = csv.armarCsv(
            ["Fecha", "Comprobante", "Número", "Proveedor", "CUIT", "Neto", "IVA 21%", "IVA 10,5%", "IVA 27%", "Exento", "Percepciones", "Total", "Da crédito fiscal", "CAE"],
            filas,
            [csv.textoCsv("Totales"), "", "", "", "", csv.numeroCsv(t.neto), csv.numeroCsv(t.iva21), csv.numeroCsv(t.iva105), csv.numeroCsv(t.iva27),
              csv.numeroCsv(t.exento), csv.numeroCsv(t.percepciones), csv.numeroCsv(t.total), csv.textoCsv(`Computable: ${csv.numeroCsv(computable)}`), ""],
          );
          res.writeHead(200, { "content-type": "text/csv; charset=utf-8" });
          return res.end(cuerpo);
        }
        case "/pagar": {
          // Un pago con su retención, como lo arma pagarAProveedor.
          const r = await pago.registrarPagoAProveedor({
            supplierId: u.searchParams.get("proveedor") ?? "",
            total: 100000,
            medio: "transferencia",
            retenciones: [{ regimenId: u.searchParams.get("regimen") ?? "", base: 100000 }],
            usuarioId: process.env.BENCH_USUARIO ?? "",
          });
          if (!r.ok) {
            res.writeHead(422);
            return res.end(r.error);
          }
          v = r;
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
  }).listen(8388, () => console.log("ts-servidor en :8388"));
}
main();
