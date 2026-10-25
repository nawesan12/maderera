import { cache } from "react";
import "server-only";

import { apiPublica, datos } from "@/lib/api/servidor";
import { sucursalPublicada } from "@/lib/sucursales";
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

export const listarSucursalesPublicas = cache(
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
          imagenUrl: ficha?.imagenUrl ?? null,
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
