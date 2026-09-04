/**
 * Siembra los regímenes de retención.
 *
 * **Los valores son los vigentes al momento de escribir esto y no son la
 * verdad permanente:** ARCA los actualiza por resolución varias veces al año, y
 * por eso viven en la base y no en el código. Este script deja la tabla lista
 * para operar; mantenerla al día es tarea del contador.
 *
 * Uso: npm run db:seed-retenciones
 */
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";
import { REGIMENES_INICIALES } from "../retenciones/calculo";

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool, { schema, casing: "snake_case" });

  console.log("Regímenes de retención…");

  for (const r of REGIMENES_INICIALES) {
    await db
      .insert(schema.regimenesRetencion)
      .values({
        codigo: r.codigo,
        nombre: r.nombre,
        impuesto: r.impuesto,
        alicuota: r.alicuota.toFixed(3),
        alicuotaNoInscripto: r.alicuotaNoInscripto.toFixed(3),
        minimoNoImponible: r.minimoNoImponible.toFixed(2),
        minimoRetencion: r.minimoRetencion.toFixed(2),
      })
      .onConflictDoNothing();

    console.log(`  ${r.codigo} · ${r.nombre}`);
  }

  console.log(
    "\nListo. Revisá las alícuotas y los mínimos con el contador antes de retener de verdad.",
  );

  await pool.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
