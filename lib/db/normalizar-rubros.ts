/**
 * Lleva los rubros escritos a mano al catálogo.
 *
 * `customers.rubro` fue texto libre durante toda la primera etapa, así que la
 * cartera trae «Carpintero», «carpinteria» y «CARPINTERÍA» escritos por tres
 * personas distintas. Un filtro por rubro que los trate como tres rubros
 * distintos no sirve para lo que la clienta lo pidió: ver cómo crece cada
 * gremio.
 *
 * **Es repetible**: se puede correr todas las veces que haga falta —después de
 * cada tanda de migración del sistema viejo, por ejemplo— y lo que ya está
 * normalizado no cambia. Lo que no reconoce **no lo toca**: perder el dato
 * sería peor que tenerlo escrito raro.
 *
 * Uso: npx tsx --env-file=.env.local lib/db/normalizar-rubros.ts
 */
import { drizzle } from "drizzle-orm/node-postgres";
import { eq, isNotNull } from "drizzle-orm";
import { Pool } from "pg";
import * as schema from "./schema";
import { normalizarRubro } from "../rubros-cliente";

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool, { schema, casing: "snake_case" });

  const fichas = await db
    .select({ id: schema.customers.id, rubro: schema.customers.rubro })
    .from(schema.customers)
    .where(isNotNull(schema.customers.rubro));

  let cambiados = 0;
  const sinReconocer = new Map<string, number>();

  for (const ficha of fichas) {
    const normalizado = normalizarRubro(ficha.rubro);

    if (!normalizado || normalizado === ficha.rubro) {
      // Lo que quedó igual y no está en el catálogo se anota para revisarlo a
      // ojo: casi siempre son dos o tres rubros que la clienta usa y que
      // conviene sumar a `lib/rubros-cliente.ts`.
      if (normalizado && !esDelCatalogo(normalizado)) {
        sinReconocer.set(normalizado, (sinReconocer.get(normalizado) ?? 0) + 1);
      }
      continue;
    }

    await db
      .update(schema.customers)
      .set({ rubro: normalizado })
      .where(eq(schema.customers.id, ficha.id));

    cambiados++;
  }

  console.log(`Fichas revisadas: ${fichas.length}`);
  console.log(`Rubros normalizados: ${cambiados}`);

  if (sinReconocer.size > 0) {
    console.log("\nSin reconocer (quedaron como estaban):");
    for (const [rubro, cuantos] of sinReconocer) {
      console.log(`  ${rubro} · ${cuantos}`);
    }
  }

  await pool.end();
}

function esDelCatalogo(valor: string): boolean {
  return schema.rubroProfesional.enumValues.includes(
    valor as (typeof schema.rubroProfesional.enumValues)[number],
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
