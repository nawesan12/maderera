import { cache } from "react";
import "server-only";

import { apiPublica, datos } from "@/lib/api/servidor";
import { conWhatsappDelSitio, sucursalPublicada } from "@/lib/sucursales";
import { ajuste } from "@/lib/dal/contenido";
import type { ZonaEnvio } from "@/lib/envios";
import { cachearPublico, ETIQUETAS } from "@/lib/cache-publico";

// El tipo y el cálculo viven en `lib/envios.ts`, sin `server-only`, para poder
// probarlos. Se reexportan para que quien ya los importaba desde acá no cambie.
export { calcularEnvio, type ZonaEnvio } from "@/lib/envios";

/** Zonas activas, ordenadas de más cerca a más lejos. */
export const listarZonasDeEnvio = cachearPublico(
  async function listarZonasDeEnvio(): Promise<ZonaEnvio[]> {
    return datos(await apiPublica.GET("/api/v1/contenido/zonas-envio"));
  },
  ["zonas-de-envio"],
  ETIQUETAS.sucursales,
);

const sucursalesCacheadas = cache(
  cachearPublico(
    async () => {
      // Las filas las da la API de Go; la ficha publicada es la constante.
      const filas = datos(await apiPublica.GET("/api/v1/contenido/sucursales"));

      return filas.map((fila) => {
        const ficha = sucursalPublicada(fila.slug);

        return {
          id: fila.id,
          slug: fila.slug,
          // El nombre lo manda la ficha publicada; el de la fila queda de
          // respaldo por si alguien agrega una sucursal en la base y todavía
          // no la escribió en `lib/sucursales.ts`.
          nombre: ficha?.nombre ?? fila.nombre,
          direccion: ficha?.direccion ?? "",
          horario: ficha?.horario ?? null,
          telefono: ficha?.telefono ?? null,
          whatsapp: ficha?.whatsapp ?? null,
          email: ficha?.email ?? null,
          mapUrl: ficha?.mapUrl ?? null,
          geo: ficha?.geo ?? null,
          // Sin foto cargada, la del frente del local: el degradado vacío
          // que quedaba en su lugar no le mostraba a nadie a dónde venir.
          imagenUrl: ficha?.imagenUrl ?? ficha?.foto?.ruta ?? null,
          foto: ficha?.foto ?? null,
          servicios: ficha?.servicios ?? "",
          destacados: ficha?.destacados ?? "",
        };
      });
    },
    ["sucursales-publicas"],
    ETIQUETAS.sucursales,
  ),
);

/**
 * Las sucursales publicadas, con el WhatsApp del sitio en la que lo atiende.
 * El número se pone afuera del caché de las sucursales: cambia con los ajustes
 * (`ETIQUETAS.ajustes`), y adentro quedaría el viejo hasta que venza.
 */
export const listarSucursalesPublicas = cache(async () => {
  const [sucursales, numero] = await Promise.all([sucursalesCacheadas(), ajuste("whatsapp_principal")]);
  return conWhatsappDelSitio(sucursales, numero);
});
