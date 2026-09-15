/**
 * Pone al día la foto de cada rubro, sin volver a sembrar el catálogo.
 *
 * Las fotos viven en `categories.image` y son las que muestran el menú de
 * «Productos» y las tarjetas del catálogo. Cambiarlas en `seed.ts` alcanza para
 * una base nueva, pero no para las que ya existen —local y producción—, y
 * correr `db:seed` entero para eso pisaría el catálogo cargado a mano.
 *
 * Este script toca **una sola columna de las categorías que ya están**. No crea
 * ni borra filas: una categoría que no esté en el mapa se deja como está, y una
 * del mapa que no exista en la base se informa y se saltea.
 *
 * Uso: npm run db:portadas
 */
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import { Pool } from "pg";
import * as schema from "./schema";
import { PORTADA } from "./portadas-datos";

const { categories } = schema;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes("localhost")
    ? false
    : { rejectUnauthorized: false },
});
const db = drizzle(pool, { schema, casing: "snake_case" });

async function main() {
  let cambiadas = 0;

  for (const [slug, image] of Object.entries(PORTADA)) {
    const filas = await db
      .update(categories)
      .set({ image, updatedAt: new Date() })
      .where(eq(categories.slug, slug))
      .returning({ slug: categories.slug });

    if (filas.length > 0) {
      cambiadas += 1;
      console.log(`  ✓ ${slug}`);
    } else {
      console.log(`  — ${slug}: no existe en esta base, se saltea`);
    }
  }

  console.log(`\nListo. ${cambiadas} portada(s) al día.`);
  console.log(
    "Si el sitio sigue mostrando las viejas, es el caché de cinco minutos de\n" +
      "`lib/cache-publico.ts`: se pasa solo.",
  );
  await pool.end();
}

main().catch(async (error) => {
  console.error(error);
  await pool.end();
  process.exit(1);
});
