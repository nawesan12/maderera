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
  /**
   * Cuándo se tocó por última vez. Lo usa el modal de aviso para saber si
   * quien ya lo cerró tiene que volver a verlo: si el equipo edita la
   * promoción, la clave cambia y el diálogo reaparece.
   */
  actualizado: Date;
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
/**
 * Lo que realmente sale del caché: la fecha, en texto.
 *
 * `unstable_cache` guarda JSON, así que el `Date` que entra vuelve string. El
 * tipo lo dice para que nadie le llame `.getTime()` a algo que ya no es una
 * fecha; `bannersDe` las rearma antes de devolverlas.
 */
type BannerGuardado = Omit<BannerPublicado, "actualizado"> & {
  actualizado: string;
};

const bannersCacheados = cachearPublico(
  async (
    ubicacion: "franja" | "portada" | "catalogo",
  ): Promise<BannerGuardado[]> => {
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
        actualizado: banners.updatedAt,
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

    return filas.map((f) => ({
      ...f,
      actualizado: f.actualizado.toISOString(),
    }));
  },
  ["banners"],
  ETIQUETAS.contenido,
);

/**
 * Los banners de una ubicación, con la fecha rearmada.
 *
 * **Esto rompió un despliegue y conviene saber por qué.** El layout público usa
 * `actualizado.getTime()` para armar la clave del aviso de bienvenida, y el
 * `Date` volvía del caché convertido en texto. No se notaba en desarrollo: la
 * primera llamada devuelve el objeto tal cual, y recién la segunda —ya
 * serializada— explota. En el build, donde cada página arranca limpia, el sitio
 * entero dejó de compilar apenas hubo un banner activo en la base.
 */
export async function bannersDe(
  ubicacion: "franja" | "portada" | "catalogo",
): Promise<BannerPublicado[]> {
  const filas = await bannersCacheados(ubicacion);
  return filas.map((f) => ({ ...f, actualizado: new Date(f.actualizado) }));
}
