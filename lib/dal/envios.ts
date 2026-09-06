import { cache } from "react";
import "server-only";

import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { branches, shippingZones } from "@/lib/db/schema";
import { sucursalPublicada } from "@/lib/sucursales";
import type { ZonaEnvio } from "@/lib/envios";
import { cachearPublico, ETIQUETAS } from "@/lib/cache-publico";

// El tipo y el cálculo viven en `lib/envios.ts`, sin `server-only`, para poder
// probarlos. Se reexportan para que quien ya los importaba desde acá no cambie.
export { calcularEnvio, type ZonaEnvio } from "@/lib/envios";

/** Zonas activas, ordenadas de más cerca a más lejos. */
export const listarZonasDeEnvio = cachearPublico(
  async function listarZonasDeEnvio(): Promise<ZonaEnvio[]> {
  const filas = await db
    .select()
    .from(shippingZones)
    .where(eq(shippingZones.activa, true))
    .orderBy(asc(shippingZones.orden));

  return filas.map((z) => ({
    id: z.id,
    nombre: z.nombre,
    costo: Number(z.costo),
    envioGratisDesde: Number(z.envioGratisDesde),
    demoraEstimada: z.demoraEstimada,
    aCotizar: z.aCotizar,
  }));
  },
  ["zonas-de-envio"],
  ETIQUETAS.sucursales,
);

/**
 * Las sucursales tal como las ve el público.
 *
 * **La ficha publicada no sale de la base**: dirección, teléfono, horario,
 * servicios y destacados viven en `lib/sucursales.ts`. Son dos locales que la
 * maderera tiene desde hace décadas, y tenerlos como columnas editables no
 * agregaba flexibilidad real: agregaba una pantalla, un camino de caché que
 * invalidar y tres versiones distintas del domicilio del aserradero
 * conviviendo en el sitio.
 *
 * De la base sale lo único que la base sabe: **qué id tiene cada sucursal y si
 * está activa**. El `id` es el que usan el stock, los pedidos, la caja y los
 * puntos de venta, y es lo que el checkout manda al elegir retiro; el `slug`
 * es el que une la fila con su ficha publicada.
 *
 * Memoizada para toda la request: el pie del sitio la pide en cada página
 * pública y encima cinco páginas la piden por su cuenta.
 */
export const listarSucursalesPublicas = cache(
  cachearPublico(
    async () => {
      const filas = await db
        .select({
          id: branches.id,
          slug: branches.slug,
          nombre: branches.name,
          sortOrder: branches.sortOrder,
        })
        .from(branches)
        .where(eq(branches.active, true))
        .orderBy(asc(branches.sortOrder));

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
          imagenUrl: ficha?.imagenUrl ?? null,
          servicios: ficha?.servicios ?? "",
          destacados: ficha?.destacados ?? "",
        };
      });
    },
    ["sucursales-publicas"],
    ETIQUETAS.sucursales,
  ),
);
