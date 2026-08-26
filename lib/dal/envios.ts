import "server-only";

import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { branches, shippingZones } from "@/lib/db/schema";
import type { ZonaEnvio } from "@/lib/envios";

// El tipo y el cálculo viven en `lib/envios.ts`, sin `server-only`, para poder
// probarlos. Se reexportan para que quien ya los importaba desde acá no cambie.
export { calcularEnvio, type ZonaEnvio } from "@/lib/envios";

/** Zonas activas, ordenadas de más cerca a más lejos. */
export async function listarZonasDeEnvio(): Promise<ZonaEnvio[]> {
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
  }));
}

/**
 * Las sucursales tal como las ve el público.
 *
 * Devuelve la ficha completa —teléfono, correo, WhatsApp, mapa— y no solo el
 * nombre porque es la misma fuente para tres cosas que tienen que decir lo
 * mismo: la página de sucursales, el selector de retiro del checkout y los
 * datos estructurados que Google muestra al costado de la búsqueda. Un horario
 * distinto en cada lado es cómo llega alguien al local un sábado a la tarde.
 */
export async function listarSucursalesPublicas() {
  return db
    .select({
      id: branches.id,
      slug: branches.slug,
      nombre: branches.name,
      direccion: branches.address,
      horario: branches.hours,
      telefono: branches.phone,
      whatsapp: branches.whatsapp,
      email: branches.email,
      mapUrl: branches.mapUrl,
      imagenUrl: branches.imagenUrl,
      servicios: branches.servicios,
      destacados: branches.destacados,
    })
    .from(branches)
    .where(eq(branches.active, true))
    .orderBy(asc(branches.sortOrder));
}
