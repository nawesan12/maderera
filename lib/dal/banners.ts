import "server-only";

import { and, asc, eq, isNull, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { banners } from "@/lib/db/schema";
import { cachearPublico, ETIQUETAS } from "@/lib/cache-publico";

export interface BannerPublicado {
  id: string;
  etiqueta: string;
  titulo: string;
  bajada: string;
  enlace: string | null;
  textoEnlace: string;
  imagenUrl: string | null;
}

/**
 * Los banners que van al aire en una ubicación.
 *
 * **La vigencia se resuelve en la consulta, no en la pantalla.** Un banner
 * vencido que se filtra en el componente igual viajó al navegador, y con caché
 * de por medio puede quedar visible después de su fecha. Acá no sale de la
 * base.
 *
 * Se cachea como el resto del contenido público, con la misma etiqueta que se
 * invalida al guardar desde el panel. El caché tiene una consecuencia que hay
 * que tener presente: un banner programado para las 00:00 puede aparecer unos
 * minutos tarde. Para una promoción de quince días eso no importa; si alguna
 * vez hiciera falta al minuto, esta consulta sale del caché.
 */
export const bannersDe = cachearPublico(
  async (ubicacion: "franja" | "portada" | "catalogo"): Promise<BannerPublicado[]> => {
    const ahora = new Date();

    const filas = await db
      .select({
        id: banners.id,
        etiqueta: banners.etiqueta,
        titulo: banners.titulo,
        bajada: banners.bajada,
        enlace: banners.enlace,
        textoEnlace: banners.textoEnlace,
        imagenUrl: banners.imagenUrl,
      })
      .from(banners)
      .where(
        and(
          eq(banners.ubicacion, ubicacion),
          eq(banners.activo, true),
          or(isNull(banners.desde), sql`${banners.desde} <= ${ahora}`),
          or(isNull(banners.hasta), sql`${banners.hasta} >= ${ahora}`),
        ),
      )
      .orderBy(asc(banners.orden), asc(banners.createdAt));

    return filas;
  },
  ["banners"],
  ETIQUETAS.contenido,
);
