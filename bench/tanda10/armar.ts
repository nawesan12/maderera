/**
 * El trabajo de CPU de una tanda, en TS: armar el correo de cada destinatario
 * (enlace de baja firmado, cuerpo a HTML y plantilla) con armarCorreoDeCampana
 * de antes de la mudanza (scripts/golden/originales/tanda10). El de Go es
 * BenchmarkArmarCorreo (backend/internal/campanas/armar_bench_test.go).
 *
 *   npx tsx --tsconfig tsconfig.json bench/tanda10/armar.ts
 */
import { createRequire } from "node:module";

const requerir = createRequire(import.meta.url);
const rutaServerOnly = requerir.resolve("server-only");
requerir.cache[rutaServerOnly] = { id: rutaServerOnly, filename: rutaServerOnly, loaded: true, exports: {} } as never;
process.env.APP_URL = "https://mjbj.com.ar";
process.env.BETTER_AUTH_SECRET = "secreto-de-prueba-de-las-bajas-32-caracteres";

async function main() {
  const { armarCorreoDeCampana } = await import("../../scripts/golden/originales/tanda10/campanas/correo");
  const c = {
    asunto: "Ofertas de noviembre",
    adelanto: null,
    cuerpo: "Hola\n\nEste mes:\n\n- **Fenólico** 18 mm\n- Pino cepillado\n\nMirá todo en https://mjbj.com.ar/catalogo.",
    imagenUrl: "/subidas/promo.jpg",
    botonTexto: "Ver el catálogo",
    botonUrl: "/catalogo",
  };
  for (let i = 0; i < 2000; i++) armarCorreoDeCampana(c, { email: `c${i}@bench.test`, nombre: "Arq. Juan Pérez" });
  const n = 50000;
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < n; i++) armarCorreoDeCampana(c, { email: `cliente${i}@bench.test`, nombre: "Arq. Juan Pérez" });
  const ns = Number(process.hrtime.bigint() - t0) / n;
  console.log(`armarCorreoDeCampana: ${(ns / 1000).toFixed(1)} µs por correo (${n} correos), memoria ${(process.memoryUsage().rss / 1048576).toFixed(0)} MB`);
}
main();
