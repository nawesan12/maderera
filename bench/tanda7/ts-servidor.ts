/**
 * El lado TypeScript del benchmark de la tanda 7: emitir y autorizar contra
 * el ARCA simulado, el libro IVA ventas en CSV y el listado, **como eran antes
 * de la mudanza** (git 56ef2a1, copiados en ts/), servidos por node:http, sin
 * Next. Ver README.md.
 *
 *   DATABASE_URL=…/bench_t7 DATABASE_POOL_MAX=20 BENCH_USUARIO=<id del admin> ARCA_…=… \
 *     npx tsx --tsconfig tsconfig.json --conditions=react-server bench/tanda7/ts-servidor.ts   # :8307
 */
import { createServer } from "node:http";

async function main() {
  const { emitirComprobante, autorizarComprobante } = await import("./ts/emitir");
  const facturacion = await import("./ts/facturacion");
  const { leerPeriodoMensual } = await import("@/lib/periodos");
  const { nombreComprobante, numeroFormateado } = await import("@/lib/fiscal/comprobantes");
  const puntoVentaId = process.env.BENCH_PUNTO_TS ?? null;

  createServer(async (req, res) => {
    const u = new URL(req.url ?? "/", "http://x");
    try {
      switch (u.pathname) {
        case "/salud":
          return res.end("ok");
        case "/emitir": {
          // Lo que hacía emitirParaLaVenta del mostrador: emitir y pedir el CAE.
          const e = await emitirComprobante({
            receptorNombre: "Mostrador",
            receptorCondicionIva: "consumidor_final",
            puntoVentaId,
            lineas: [{ descripcion: "Clavos 2\"", unidad: "kg", cantidad: 2, precioFinalUnitario: 1500 }],
          });
          const a = e.invoiceId ? await autorizarComprobante(e.invoiceId) : { error: e.error };
          res.writeHead(200, { "content-type": "application/json" });
          return res.end(JSON.stringify({ invoiceId: e.invoiceId, autorizado: Boolean(a.ok), error: a.error }));
        }
        case "/libro": {
          // app/admin/arca/libro-iva/exportar de antes.
          const { desde, hasta } = leerPeriodoMensual(u.searchParams.get("periodo"));
          const libro = await facturacion.libroIvaVentas(desde, hasta);
          const numero = (valor: number) => valor.toFixed(2).replace(".", ",");
          const texto = (valor: string | null) => `"${(valor ?? "").replace(/"/g, '""')}"`;
          const lineas = [
            ["Fecha", "Tipo", "Numero", "Cliente", "CUIT", "Neto", "IVA 21%", "IVA 10,5%", "IVA 27%", "Exento", "Percepciones", "Total", "CAE"].join(";"),
          ];
          for (const fila of libro.filas) {
            lineas.push(
              [
                fila.fechaEmision.toISOString().slice(0, 10),
                texto(nombreComprobante(fila.tipo)),
                texto(numeroFormateado(fila.puntoVenta, fila.numero)),
                texto(fila.receptorNombre),
                texto(fila.receptorCuit),
                numero(fila.neto),
                numero(fila.iva21),
                numero(fila.iva105),
                numero(fila.iva27),
                numero(fila.exento),
                numero(fila.tributos),
                numero(fila.total),
                texto(fila.cae),
              ].join(";"),
            );
          }
          res.writeHead(200, { "content-type": "text/csv; charset=utf-8" });
          return res.end("\ufeff" + lineas.join("\n"));
        }
        case "/listado": {
          const v = await facturacion.listarComprobantes({});
          res.writeHead(200, { "content-type": "application/json" });
          return res.end(JSON.stringify(v));
        }
        default:
          res.writeHead(404);
          return res.end();
      }
    } catch (e) {
      res.writeHead(500);
      res.end(String(e));
    }
  }).listen(8307, () => console.log("ts-servidor en :8307"));
}
main();
