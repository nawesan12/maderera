/**
 * Pasa a la base el contenido que estaba escrito a mano en `lib/products.ts`.
 *
 * Los seis artículos del blog y los cuatro testimonios eran constantes de
 * TypeScript: publicar una nota costaba un deploy. Este script los migra una
 * vez y después el mock se borra.
 *
 * Es idempotente: se puede correr de nuevo sin duplicar nada.
 *
 * Uso: npm run db:seed-contenido
 */
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { sql } from "drizzle-orm";
import * as schema from "./schema";

/**
 * El contenido que se migra.
 *
 * Estaba en `lib/products.ts` como constantes de TypeScript. Se copió acá al
 * migrarlo para poder borrar el mock: dejar el script importando un archivo que
 * ya no debería existir lo ataba a un módulo muerto.
 *
 * Este script corrió una vez. Queda como registro de de dónde salió el
 * contenido inicial, y por si hay que reconstruir la base desde cero.
 */
import { POSTS_INICIALES, TESTIMONIOS_INICIALES } from "./contenido-inicial";

const postsDelMock = POSTS_INICIALES;
const testimoniosDelMock = TESTIMONIOS_INICIALES;

const { blogCategories, blogPosts, testimonials, siteSettings } = schema;

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool, { schema, casing: "snake_case" });

/** Minutos de lectura a 200 palabras por minuto, el promedio en castellano. */
function minutosDeLectura(texto: string): number {
  const palabras = texto.trim().split(/\s+/).length;
  return Math.max(1, Math.round(palabras / 200));
}

function aSlug(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

async function main() {
  console.log("Categorías del blog…");

  const nombres = [...new Set(postsDelMock.map((p) => p.category))];

  await db
    .insert(blogCategories)
    .values(
      nombres.map((nombre, i) => ({
        slug: aSlug(nombre),
        nombre,
        orden: i,
      })),
    )
    .onConflictDoNothing({ target: blogCategories.slug });

  const categorias = await db.select().from(blogCategories);
  const porNombre = new Map(categorias.map((c) => [c.nombre, c.id]));

  console.log("Artículos…");

  await db
    .insert(blogPosts)
    .values(
      postsDelMock.map((post) => ({
        slug: post.slug,
        titulo: post.title,
        resumen: post.excerpt,
        contenido: post.content,
        imagenUrl: post.image,
        categoryId: porNombre.get(post.category) ?? null,
        autor: "Maderera Juan B. Justo",
        estado: "publicado" as const,
        // La fecha del mock viene como texto ISO; si no se puede leer, se
        // publica con la fecha de hoy antes que quedar sin fecha.
        publicadoAt: Number.isNaN(new Date(post.date).getTime())
          ? new Date()
          : new Date(post.date),
        minutosLectura: minutosDeLectura(post.content),
      })),
    )
    .onConflictDoNothing({ target: blogPosts.slug });

  console.log("Testimonios…");

  const yaHay = await db.select({ id: testimonials.id }).from(testimonials).limit(1);

  if (yaHay.length === 0) {
    await db.insert(testimonials).values(
      testimoniosDelMock.map((t, i) => ({
        nombre: t.name,
        rol: t.role,
        texto: t.text,
        iniciales: t.avatar,
        orden: i,
      })),
    );
  }

  console.log("Ajustes del sitio…");

  await db
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
        descripcion:
          "Texto de la franja de arriba de todo. Vacío la oculta.",
      },
      {
        clave: "envio_gratis_leyenda",
        valor: "Envío sin cargo en Mar del Plata a partir de $200.000",
        descripcion: "Leyenda de la franja de confianza del catálogo.",
      },
    ])
    .onConflictDoNothing({ target: siteSettings.clave });

  const [conteo] = await db
    .select({ posts: sql<number>`count(*)::int` })
    .from(blogPosts);

  console.log(`\nListo. ${conteo.posts} artículos en la base.`);
  await pool.end();
}

main().catch(async (error) => {
  console.error(error);
  await pool.end();
  process.exit(1);
});
