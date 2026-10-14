/**
 * Recorre el sitio público buscando el defecto que da el error #419.
 *
 * Pide cada página como un navegador —con y sin parámetros en la dirección,
 * que es lo que obliga a armar una parte en cada visita— y avisa si en el HTML
 * hay números de límite repetidos. Ver `lib/diagnostico/limites.ts`.
 *
 * **Contra un build de producción**, no contra `next dev`: en desarrollo no
 * hay parte armada de antemano y el defecto no aparece.
 *
 *   npx next build && npx next start -p 3101
 *   npx tsx scripts/revisar-limites.ts http://localhost:3101
 *
 * Sin argumento usa `http://localhost:3000`. Sale con código 1 si encontró
 * algo, para poder usarlo antes de desplegar.
 */
import { limitesRepetidos } from "../lib/diagnostico/limites";

const base = (process.argv[2] ?? "http://localhost:3000").replace(/\/$/, "");

/** Las de siempre, más las que agregan parámetros: ahí apareció el #419. */
const FIJAS = [
  "/",
  "/catalogo",
  "/catalogo?cat=placas",
  "/stock",
  "/stock?q=pino",
  "/corte",
  "/calculadora",
  "/moldava",
  "/profesionales",
  "/eventos",
  "/sucursales",
  "/nosotros",
  "/contacto",
  "/documentacion",
  "/carrito",
  "/ingresar",
  "/registro",
];

async function delSitemap(): Promise<string[]> {
  try {
    const xml = await (await fetch(`${base}/sitemap.xml`)).text();
    return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1]!).pathname);
  } catch {
    return [];
  }
}

async function main() {
  const rutas = [...new Set([...FIJAS, ...(await delSitemap())])];
  let conProblemas = 0;

  for (const ruta of rutas) {
    const respuesta = await fetch(`${base}${ruta}`, {
      headers: { "user-agent": "Mozilla/5.0 (revisar-limites)" },
    });
    const repetidos = limitesRepetidos(await respuesta.text());
    if (repetidos.length > 0) {
      conProblemas++;
      console.log(`✗ ${ruta} (${respuesta.status}): repetidos ${repetidos.join(", ")}`);
    }
  }

  console.log(
    conProblemas === 0
      ? `✓ ${rutas.length} páginas sin límites repetidos`
      : `${conProblemas} de ${rutas.length} páginas con límites repetidos`,
  );
  process.exit(conProblemas === 0 ? 0 : 1);
}

main();
