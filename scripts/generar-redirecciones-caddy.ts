/**
 * Escribe `servidor/caddy/sitio-viejo.caddy` a partir de `lib/sitio-viejo.ts`.
 *
 * El mapa de redirecciones del sitio viejo vive en TypeScript —ahí se prueba y
 * de ahí lo lee Next—, pero quien lo aplica de verdad es Caddy, en el bloque
 * de `mjbj.ar`: así cada dirección vieja llega a su destino de un solo salto.
 * Caddy no lee TypeScript, así que este script le deja el mapa en su idioma.
 *
 * Se corre después de tocar la lista:
 *
 *   npx tsx scripts/generar-redirecciones-caddy.ts
 *
 * y se commitea el archivo generado. `tests/sitio-viejo.test.ts` falla si
 * alguien cambia la lista y se olvida de esto.
 */

import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { mapaParaCaddy } from "../lib/sitio-viejo";

const destino = join(process.cwd(), "servidor/caddy/sitio-viejo.caddy");

writeFile(destino, mapaParaCaddy()).then(() => {
  console.log(`Escrito ${destino}`);
});
