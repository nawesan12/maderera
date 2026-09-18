import "server-only";

import { db } from "@/lib/db";
import { businessReviews } from "@/lib/db/schema";
import { cachearPublico, ETIQUETAS } from "@/lib/cache-publico";
import { and, asc, desc, eq, sql } from "drizzle-orm";

/**
 * Las reseñas del negocio que se muestran en el sitio.
 *
 * **Dos fuentes y un solo lugar donde se leen.** Las que el equipo carga a mano
 * desde el panel —copiadas de Google, elegidas— y las que trae la API de Places
 * cuando hay clave configurada. Se guardan todas en la misma tabla, así que la
 * pantalla no sabe ni le importa de dónde vino cada una.
 *
 * **Por qué la API no se consulta al mostrar.** Places cobra por consulta y
 * devuelve como mucho cinco reseñas, sin elegir cuáles; además, si un día falla
 * o se acaba la cuota, la portada se quedaría sin la sección. Se sincroniza
 * cada tanto y lo que se muestra sale siempre de la base: si no hay clave, se
 * muestran las cargadas a mano y el sitio funciona igual.
 */
export interface ResenaDelNegocio {
  id: string;
  autor: string;
  estrellas: number;
  texto: string;
  fecha: Date;
  origen: "manual" | "google";
  fotoUrl: string | null;
}

export const resenasDelNegocio = cachearPublico(
  async (): Promise<ResenaDelNegocio[]> => {
    const filas = await db
      .select({
        id: businessReviews.id,
        autor: businessReviews.autor,
        estrellas: businessReviews.estrellas,
        texto: businessReviews.texto,
        fecha: businessReviews.fecha,
        origen: businessReviews.origen,
        fotoUrl: businessReviews.fotoUrl,
      })
      .from(businessReviews)
      .where(eq(businessReviews.publicada, true))
      .orderBy(asc(businessReviews.orden), desc(businessReviews.fecha))
      .limit(12);

    return filas;
  },
  ["resenas-del-negocio"],
  ETIQUETAS.contenido,
);

/** El promedio y cuántas hay, para el encabezado de la sección. */
export const resumenDelNegocio = cachearPublico(
  async (): Promise<{ promedio: number; cuantas: number } | null> => {
    const [fila] = await db
      .select({
        promedio: sql<string>`avg(${businessReviews.estrellas})`,
        cuantas: sql<number>`count(*)::int`,
      })
      .from(businessReviews)
      .where(eq(businessReviews.publicada, true));

    if (!fila || Number(fila.cuantas) === 0) return null;

    return {
      promedio: Math.round(Number(fila.promedio) * 10) / 10,
      cuantas: Number(fila.cuantas),
    };
  },
  ["resumen-resenas-negocio"],
  ETIQUETAS.contenido,
);

/**
 * Trae las reseñas de Google y las guarda.
 *
 * Necesita dos variables de entorno: `GOOGLE_PLACES_API_KEY` y
 * `GOOGLE_PLACE_ID`. **Sin ellas no falla: no hace nada y lo dice.** Es
 * deliberado —el acceso a Google Business estaba comprometido para el 15/09 y
 * todavía no llegó— y es lo que permite que la sección exista y se use con
 * reseñas cargadas a mano desde el primer día.
 *
 * Las que trae quedan **sin publicar**: alguien las lee antes de ponerlas en la
 * portada. Google devuelve las cinco que él elige, y no siempre son las que uno
 * pondría al frente del negocio.
 */
export async function sincronizarResenasDeGoogle(): Promise<{
  traidas: number;
  nuevas: number;
  error?: string;
}> {
  const clave = process.env.GOOGLE_PLACES_API_KEY;
  const lugar = process.env.GOOGLE_PLACE_ID;

  if (!clave || !lugar) {
    return {
      traidas: 0,
      nuevas: 0,
      error:
        "Faltan GOOGLE_PLACES_API_KEY y GOOGLE_PLACE_ID. Mientras tanto, las reseñas se cargan a mano.",
    };
  }

  let datos: {
    reviews?: {
      name?: string;
      rating?: number;
      text?: { text?: string };
      originalText?: { text?: string };
      publishTime?: string;
      authorAttribution?: { displayName?: string; photoUri?: string };
    }[];
  };

  try {
    const respuesta = await fetch(
      `https://places.googleapis.com/v1/places/${encodeURIComponent(lugar)}`,
      {
        headers: {
          "X-Goog-Api-Key": clave,
          // Solo el campo que se usa: Places cobra por campo pedido.
          "X-Goog-FieldMask": "reviews",
        },
        // La sincronización es explícita: nunca se sirve de un caché viejo.
        cache: "no-store",
      },
    );

    if (!respuesta.ok) {
      return {
        traidas: 0,
        nuevas: 0,
        error: `Google contestó ${respuesta.status}. Revisá la clave y el id del lugar.`,
      };
    }

    datos = await respuesta.json();
  } catch {
    return {
      traidas: 0,
      nuevas: 0,
      error: "No se pudo hablar con Google. Probá de nuevo en un rato.",
    };
  }

  const resenas = datos.reviews ?? [];
  let nuevas = 0;

  for (const resena of resenas) {
    const texto = resena.originalText?.text ?? resena.text?.text ?? "";
    const autor = resena.authorAttribution?.displayName ?? "Cliente de Google";

    if (!texto.trim() || !resena.name) continue;

    const [creada] = await db
      .insert(businessReviews)
      .values({
        autor,
        estrellas: Math.round(resena.rating ?? 5),
        texto: texto.trim(),
        fecha: resena.publishTime ? new Date(resena.publishTime) : new Date(),
        origen: "google",
        externoId: resena.name,
        fotoUrl: resena.authorAttribution?.photoUri ?? null,
        // Sin publicar: alguien la lee antes de ponerla en la portada.
        publicada: false,
      })
      // Ya estaba: la misma reseña no entra dos veces.
      .onConflictDoNothing({ target: businessReviews.externoId })
      .returning({ id: businessReviews.id });

    if (creada) nuevas++;
  }

  return { traidas: resenas.length, nuevas };
}

/** Las reseñas para el panel, publicadas o no. */
export async function listarResenasDelNegocio() {
  return db
    .select()
    .from(businessReviews)
    .orderBy(asc(businessReviews.orden), desc(businessReviews.fecha));
}

/** Cuántas están esperando que alguien las lea. */
export async function resenasSinPublicar(): Promise<number> {
  const [fila] = await db
    .select({ cuantas: sql<number>`count(*)::int` })
    .from(businessReviews)
    .where(and(eq(businessReviews.publicada, false)));

  return Number(fila?.cuantas ?? 0);
}
