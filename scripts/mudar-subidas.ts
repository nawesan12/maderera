/**
 * Mudanza de los archivos de Vercel Blob al disco del servidor propio.
 *
 * Mientras el sitio vivió en Vercel, lo que se subía desde el panel —fotos de
 * productos, banners, promociones, comprobantes de pago, adjuntos de WhatsApp,
 * la firma de un remito— iba a Vercel Blob, y lo que quedó en la base es la
 * URL completa de Blob. Después de mudarse, esas URLs siguen apuntando a
 * Vercel: mientras la cuenta exista, se ven; el día que se dé de baja,
 * desaparecen todas juntas.
 *
 * Este script las trae: baja cada archivo a `CARPETA_SUBIDAS` y reescribe la
 * base para que diga `/subidas/<nombre>`, que es lo mismo que guarda hoy
 * `lib/almacenamiento.ts` cuando sube al disco.
 *
 * **No hay una lista de columnas, y es a propósito.** En vez de enumerar
 * `product_images.url`, `banners.imagen_url` y compañía —una lista que se
 * desactualiza con la próxima tabla que tenga una foto—, recorre todas las
 * columnas de texto y JSON del esquema `public` y busca el dominio de Blob
 * adentro. Así también aparecen las URLs metidas en el medio de un texto o de
 * un JSON, que una lista de columnas no vería.
 *
 * **Se puede correr las veces que haga falta.** Un archivo que ya está en el
 * disco no se vuelve a bajar, y una fila ya reescrita no tiene más URLs de
 * Blob, así que la segunda corrida no encuentra nada que hacer. Si una
 * descarga falla, esa URL queda como estaba y la próxima corrida la reintenta.
 *
 * Uso, en el servidor (adentro del contenedor del migrador, que tiene la base
 * y el volumen de subidas montados):
 *
 *   docker compose --env-file .env.produccion -f docker-compose.prod.yml \
 *     --profile herramientas run --rm migrador \
 *     node_modules/.bin/tsx scripts/mudar-subidas.ts --probar
 *
 * `--probar` solo cuenta y muestra qué haría: no baja nada ni toca la base.
 * Sin esa opción, hace la mudanza.
 *
 * En local: `npx tsx --env-file=.env.local scripts/mudar-subidas.ts --probar`.
 */

import { createHash } from "node:crypto";
import { mkdir, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Client } from "pg";

const PROBAR = process.argv.includes("--probar");

const URL_BASE = process.env.DATABASE_URL;
if (!URL_BASE) {
  console.error("Falta DATABASE_URL.");
  process.exit(1);
}

const CARPETA =
  process.env.CARPETA_SUBIDAS || path.join(process.cwd(), "public", "subidas");

/**
 * Una URL pública de Blob. Corta en lo que no puede ser parte de una URL
 * dentro de un texto, de un JSON o de un arreglo de Postgres —que se escribe
 * `{a,b}`, sin comillas—: espacios, comillas, signos de HTML, llaves y comas.
 * Las URLs de Blob no llevan ninguno de esos.
 */
const URL_BLOB =
  /https:\/\/[a-z0-9-]+\.public\.blob\.vercel-storage\.com\/[^\s"'<>()\\{}[\],]+/gi;

/** El punto final de una oración no es parte de la URL que la termina. */
const limpiarFinal = (url: string) => url.replace(/[.;:!?]+$/, "");

/** Mismo criterio que `nombreDeSubida` en `lib/almacenamiento.ts`. */
const NOMBRE_VALIDO = /^[A-Za-z0-9][A-Za-z0-9._-]{0,200}$/;

/** Misma regla que `lib/db/index.ts` para decidir si la conexión va cifrada. */
function usaSsl(url: string): boolean {
  const declarado = process.env.DATABASE_SSL?.trim().toLowerCase();
  if (declarado === "true" || declarado === "on") return true;
  if (declarado === "false" || declarado === "off") return false;
  return !url.includes("localhost") && !url.includes("127.0.0.1");
}

interface Columna {
  tabla: string;
  columna: string;
  tipo: string;
}

/** Las columnas donde puede haber una URL guardada. */
async function columnasDeTexto(cliente: Client): Promise<Columna[]> {
  const { rows } = await cliente.query<Columna>(`
    SELECT c.relname AS tabla,
           a.attname AS columna,
           format_type(a.atttypid, a.atttypmod) AS tipo
      FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relkind IN ('r', 'p')
       -- Los adjuntos de WhatsApp no van a la carpeta pública: los muda
       -- mudarAdjuntosDeWhatsapp, a la privada.
       AND NOT (c.relname = 'whatsapp_mensajes' AND a.attname = 'media_url')
       AND a.attnum > 0
       AND NOT a.attisdropped
       AND (format_type(a.atttypid, a.atttypmod) IN ('text', 'json', 'jsonb', 'text[]')
            OR format_type(a.atttypid, a.atttypmod) LIKE 'character varying%')
     ORDER BY 1, 2
  `);
  return rows;
}

const ident = (nombre: string) => `"${nombre.replace(/"/g, '""')}"`;

/**
 * El nombre con que queda en el disco: el último tramo de la URL, limpio.
 *
 * Los nombres que generaba la app ya son únicos (`producto-<uuid>.jpg`), así
 * que casi siempre queda igual. Si dos URLs distintas terminan en el mismo
 * nombre, a las dos se les agrega un pedazo del hash de la URL: es estable,
 * así que una segunda corrida elige el mismo nombre que la primera.
 */
function nombresEnDisco(urls: string[]): Map<string, string> {
  const base = new Map<string, string>();
  for (const url of urls) {
    const ultimo = decodeURIComponent(
      new URL(url).pathname.split("/").filter(Boolean).pop() ?? "archivo",
    );
    let limpio = ultimo.replace(/[^A-Za-z0-9._-]/g, "-").replace(/^[^A-Za-z0-9]+/, "");
    if (!limpio) limpio = "archivo";
    base.set(url, limpio.slice(-150));
  }

  const usos = new Map<string, number>();
  for (const nombre of base.values()) usos.set(nombre, (usos.get(nombre) ?? 0) + 1);

  const final = new Map<string, string>();
  for (const [url, nombre] of base) {
    let elegido = nombre;
    if ((usos.get(nombre) ?? 0) > 1) {
      const hash = createHash("sha1").update(url).digest("hex").slice(0, 8);
      const ext = path.extname(nombre);
      elegido = `${nombre.slice(0, nombre.length - ext.length)}-${hash}${ext}`;
    }
    if (!NOMBRE_VALIDO.test(elegido)) {
      elegido = `blob-${createHash("sha1").update(url).digest("hex").slice(0, 16)}`;
    }
    final.set(url, elegido);
  }
  return final;
}

async function existe(ruta: string): Promise<boolean> {
  try {
    return (await stat(ruta)).size > 0;
  } catch {
    return false;
  }
}

async function bajar(url: string, destino: string): Promise<void> {
  const respuesta = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!respuesta.ok) throw new Error(`respondió ${respuesta.status}`);
  const bytes = new Uint8Array(await respuesta.arrayBuffer());
  if (bytes.byteLength === 0) throw new Error("llegó vacío");

  // Se escribe con otro nombre y se renombra: un archivo a medio bajar no
  // puede quedar con el nombre bueno, porque la próxima corrida lo daría por
  // hecho.
  const temporal = `${destino}.parcial`;
  await writeFile(temporal, bytes);
  await rename(temporal, destino);
}

async function main() {
  const cliente = new Client({
    connectionString: URL_BASE,
    ssl: usaSsl(URL_BASE!) ? { rejectUnauthorized: true } : false,
  });
  await cliente.connect();

  try {
    console.log(PROBAR ? "Modo prueba: no se baja ni se escribe nada.\n" : "");
    console.log(`Carpeta de destino: ${CARPETA}\n`);

    // 1. Dónde hay URLs de Blob, y cuáles son.
    const columnas = await columnasDeTexto(cliente);
    const conBlob: { columna: Columna; filas: number }[] = [];
    const urls = new Set<string>();

    for (const columna of columnas) {
      const { rows } = await cliente.query<{ valor: string }>(
        `SELECT ${ident(columna.columna)}::text AS valor
           FROM ${ident(columna.tabla)}
          WHERE ${ident(columna.columna)}::text LIKE '%.blob.vercel-storage.com/%'`,
      );
      if (rows.length === 0) continue;

      conBlob.push({ columna, filas: rows.length });
      for (const { valor } of rows) {
        for (const encontrada of valor.match(URL_BLOB) ?? []) {
          urls.add(limpiarFinal(encontrada));
        }
      }
    }

    if (urls.size === 0) {
      console.log("No hay URLs de Vercel Blob en la base. Nada que mudar.");
      await mudarAdjuntosDeWhatsapp(cliente);
      return;
    }

    console.log("Columnas con URLs de Blob:");
    for (const { columna, filas } of conBlob) {
      console.log(`  ${columna.tabla}.${columna.columna} (${columna.tipo}): ${filas} filas`);
    }
    console.log(`\n${urls.size} archivos distintos.\n`);

    // Las más largas primero: si una URL es el comienzo de otra —la misma
    // con `?download=1`—, reemplazar la corta antes rompería la larga.
    const ordenadas = [...urls].sort((a, b) => b.length - a.length);
    const nombres = nombresEnDisco(ordenadas);

    // 2. Bajarlas.
    if (!PROBAR) await mkdir(CARPETA, { recursive: true });

    const listas: string[] = [];
    const fallidas: string[] = [];

    for (const url of ordenadas) {
      const nombre = nombres.get(url)!;
      const destino = path.join(CARPETA, nombre);
      const yaEsta = await existe(destino);

      if (PROBAR) {
        console.log(`  ${yaEsta ? "ya está " : "bajaría "} ${url}\n           → /subidas/${nombre}`);
        continue;
      }

      if (yaEsta) {
        listas.push(url);
        continue;
      }

      try {
        await bajar(url, destino);
        listas.push(url);
        console.log(`  bajado  ${nombre}`);
      } catch (error) {
        fallidas.push(url);
        console.error(`  FALLÓ   ${url}: ${(error as Error).message}`);
      }
    }

    if (PROBAR) {
      console.log("\nPara hacer la mudanza, correr de nuevo sin --probar.");
      return;
    }

    // 3. Reescribir la base, todo junto o nada: una mudanza a medias deja
    // filas apuntando a archivos que todavía no se sabe si están.
    let reescritas = 0;
    await cliente.query("BEGIN");
    try {
      for (const url of listas) {
        const nuevo = `/subidas/${nombres.get(url)}`;
        for (const { columna } of conBlob) {
          const c = ident(columna.columna);
          const { rowCount } = await cliente.query(
            `UPDATE ${ident(columna.tabla)}
                SET ${c} = replace(${c}::text, $1, $2)::${columna.tipo}
              WHERE strpos(${c}::text, $1) > 0`,
            [url, nuevo],
          );
          reescritas += rowCount ?? 0;
        }
      }
      await cliente.query("COMMIT");
    } catch (error) {
      await cliente.query("ROLLBACK");
      throw error;
    }

    console.log(
      `\nListo: ${listas.length} archivos en el disco, ${reescritas} valores reescritos.`,
    );

    await mudarAdjuntosDeWhatsapp(cliente);
    if (fallidas.length > 0) {
      console.log(
        `${fallidas.length} no se pudieron bajar y quedaron como estaban; correr de nuevo para reintentarlas.`,
      );
      process.exitCode = 1;
    }
  } finally {
    await cliente.end();
  }
}

/**
 * Los adjuntos de las conversaciones de WhatsApp, a la carpeta **privada**.
 *
 * Son fotos y documentos de clientes: no pueden terminar en `/subidas/`, que
 * Caddy sirve a cualquiera. Van a `CARPETA_PRIVADA` y la fila queda como
 * `privado:<nombre>`, que es lo que lee `/api/whatsapp/medios/<id>`. Se
 * mudan los de Blob y los que quedaron en la carpeta pública de antes.
 */
async function mudarAdjuntosDeWhatsapp(cliente: Client) {
  const privada = process.env.CARPETA_PRIVADA || path.join(process.cwd(), ".privado", "whatsapp");
  const { rows } = await cliente.query<{ id: string; media_url: string }>(
    `SELECT id, media_url FROM whatsapp_mensajes
      WHERE media_url LIKE 'https://%blob.vercel-storage.com/%' OR media_url LIKE '/subidas/whatsapp-%'`,
  );
  if (rows.length === 0) return;

  console.log(`\nAdjuntos de WhatsApp a mudar a ${privada}: ${rows.length}`);
  if (PROBAR) return;
  await mkdir(privada, { recursive: true });

  let mudados = 0;
  for (const fila of rows) {
    const nombre = `whatsapp-${createHash("sha1").update(fila.media_url).digest("hex").slice(0, 24)}${path.extname(fila.media_url.split("?")[0]) || ".bin"}`;
    const destino = path.join(privada, nombre);
    try {
      if (!(await existe(destino))) {
        if (fila.media_url.startsWith("/subidas/")) {
          await rename(path.join(CARPETA, path.basename(fila.media_url)), destino);
        } else {
          await bajar(fila.media_url, destino);
        }
      }
      await cliente.query("UPDATE whatsapp_mensajes SET media_url = $1 WHERE id = $2", [`privado:${nombre}`, fila.id]);
      mudados++;
    } catch (error) {
      console.log(`  no se pudo: ${fila.media_url} (${(error as Error).message})`);
      process.exitCode = 1;
    }
  }
  console.log(`Adjuntos de WhatsApp mudados: ${mudados} de ${rows.length}.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
