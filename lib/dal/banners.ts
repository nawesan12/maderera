import "server-only";

import { cachearPublico, ETIQUETAS } from "@/lib/cache-publico";
import { apiPublica, datos } from "@/lib/api/servidor";

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

// Los arma la API de Go (backend/internal/contenido): los de la ubicación,
// activos y dentro de sus fechas.
const bannersCacheados = cachearPublico(
  async (ubicacion: "franja" | "portada" | "catalogo"): Promise<BannerGuardado[]> =>
    datos(await apiPublica.GET("/api/v1/contenido/banners", { params: { query: { ubicacion } } })),
  ["banners"],
  ETIQUETAS.contenido,
);

export async function bannersDe(
  ubicacion: "franja" | "portada" | "catalogo",
): Promise<BannerPublicado[]> {
  const filas = await bannersCacheados(ubicacion);
  return filas.map((f) => ({ ...f, actualizado: new Date(f.actualizado) }));
}
