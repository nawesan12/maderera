/**
 * Compara el espejo drizzle (`lib/db/schema`) con una base migrada por goose.
 *
 * Desde la mudanza a Go las migraciones son las de `backend/db/migraciones` y
 * drizzle quedó solo para las semillas y un par de scripts. Nadie lo
 * regenera, así que cada columna nueva de goose lo dejaba atrás sin que
 * nada avisara: a la 00201 le faltaban más de sesenta. Este chequeo lo hace
 * visible: falla si una tabla espejada no tiene una columna de la base, si
 * el espejo nombra una que la base no tiene, o si aparece una tabla nueva
 * que no está ni en el espejo ni en `SOLO_EN_GO`.
 *
 * Uso, contra una base local migrada (`npm run db:migrate`):
 *   npm run db:espejo
 *
 * Mira nombres, no tipos: lo que rompe una semilla es la columna que falta o
 * sobra, y los tipos los fija goose.
 */
import { is } from "drizzle-orm";
import { toSnakeCase } from "drizzle-orm/casing";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import { Pool } from "pg";
import * as schema from "../lib/db/schema";

/**
 * Tablas que existen solo del lado de Go: ninguna semilla ni script del
 * frente las escribe. Si una semilla llega a necesitarla, se espeja y se
 * saca de acá.
 */
const SOLO_EN_GO = new Set([
  "goose_db_version",
  "bases_de_retencion",
  "cheque_estados",
  "consultas_corte",
  "consultas_corte_grupos",
  "correo_hilos",
  "correo_notas",
  "correo_plantillas",
  "correo_seguimientos",
  "devolucion_items",
  "devoluciones",
  "fotos_biblioteca_descartadas",
  "invoices_dadas_de_baja",
  "padron_iibb",
  "padron_iibb_importaciones",
  "payment_refunds",
  // Copia de respaldo que dejó la 00150 al normalizar los rubros.
  "product_images_rubro_00150",
  "receipt_refunds",
  // Los traslados entre sucursales (00270): los escribe solo Go.
  "stock_traslado_items",
  "stock_traslados",
  "technical_document_targets",
]);

function espejo(): Map<string, Set<string>> {
  const tablas = new Map<string, Set<string>>();
  for (const valor of Object.values(schema)) {
    if (!is(valor, PgTable)) continue;
    const config = getTableConfig(valor);
    tablas.set(
      config.name,
      new Set(
        config.columns.map((c) => (c.keyAsName ? toSnakeCase(c.name) : c.name)),
      ),
    );
  }
  return tablas;
}

async function base(pool: Pool): Promise<Map<string, Set<string>>> {
  const { rows } = await pool.query<{ tabla: string; columna: string }>(
    `SELECT table_name AS tabla, column_name AS columna
       FROM information_schema.columns
      WHERE table_schema = 'public'`,
  );
  const tablas = new Map<string, Set<string>>();
  for (const { tabla, columna } of rows) {
    if (!tablas.has(tabla)) tablas.set(tabla, new Set());
    tablas.get(tabla)!.add(columna);
  }
  return tablas;
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("Falta DATABASE_URL (una base local migrada).");
    process.exit(2);
  }
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const enBase = await base(pool);
  await pool.end();
  const enEspejo = espejo();

  const problemas: string[] = [];
  for (const [tabla, columnas] of enBase) {
    const espejadas = enEspejo.get(tabla);
    if (!espejadas) {
      if (!SOLO_EN_GO.has(tabla)) {
        problemas.push(`${tabla}: tabla nueva, ni espejada ni en SOLO_EN_GO`);
      }
      continue;
    }
    for (const c of columnas) {
      if (!espejadas.has(c)) problemas.push(`${tabla}.${c}: falta en el espejo`);
    }
    for (const c of espejadas) {
      if (!columnas.has(c)) problemas.push(`${tabla}.${c}: el espejo la tiene y la base no`);
    }
  }
  for (const tabla of enEspejo.keys()) {
    if (!enBase.has(tabla)) problemas.push(`${tabla}: espejada y la base no la tiene`);
  }
  for (const tabla of SOLO_EN_GO) {
    if (enEspejo.has(tabla)) problemas.push(`${tabla}: espejada y también en SOLO_EN_GO`);
  }

  if (problemas.length) {
    console.error(`El espejo drizzle no coincide con la base (${problemas.length}):`);
    for (const p of problemas.sort()) console.error(`  ${p}`);
    process.exit(1);
  }
  console.log(
    `El espejo coincide: ${enEspejo.size} tablas espejadas, ${SOLO_EN_GO.size} solo en Go.`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
