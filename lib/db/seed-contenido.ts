/**
 * Los textos editables del sitio.
 *
 * Este script sembraba además los seis artículos del blog y los cuatro
 * testimonios que venían del prototipo. **Los dos salieron el 7/9/2026**, por
 * pedido de la clienta: las notas las había escrito el prototipo y los
 * testimonios eran personas inventadas. El contenido del blog quedó
 * respaldado fuera del repo antes de borrarlo.
 *
 * Lo que queda son los tres ajustes, y quedan porque los lee todo el sitio: el
 * número de WhatsApp de los botones, la franja de arriba de todo y la leyenda
 * del envío. Sin fila cargada, el sitio cae a valores por defecto y esos
 * textos dejan de poder cambiarse desde el panel.
 *
 * Es idempotente: se puede correr de nuevo sin pisar lo que alguien haya
 * editado a mano.
 *
 * Uso: npm run db:seed-contenido
 */
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

const { siteSettings } = schema;

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool, { schema, casing: "snake_case" });

async function main() {
  console.log("Ajustes del sitio…");

  const { rowCount } = await db
    .insert(siteSettings)
    .values([
      {
        clave: "whatsapp_principal",
        valor: "542235903118",
        descripcion: "Número al que van los botones de WhatsApp del sitio.",
      },
      {
        clave: "aviso_barra_superior",
        valor: "",
        descripcion: "Texto de la franja de arriba de todo. Vacío la oculta.",
      },
      {
        clave: "envio_gratis_leyenda",
        valor: "Envío sin cargo en Mar del Plata a partir de $200.000",
        descripcion: "Leyenda de la franja de confianza del catálogo.",
      },
    ])
    // `DoNothing` y no `DoUpdate`: el valor de estas tres claves se edita desde
    // el panel, y volver a correr el sembrado no puede pisar lo que la clienta
    // cargó.
    .onConflictDoNothing({ target: siteSettings.clave });

  console.log(`\nListo. ${rowCount ?? 0} ajuste(s) nuevo(s).`);
  await pool.end();
}

main().catch(async (error) => {
  console.error(error);
  await pool.end();
  process.exit(1);
});
