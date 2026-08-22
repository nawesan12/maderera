import "server-only";

import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { branches, shippingZones } from "@/lib/db/schema";

export interface ZonaEnvio {
  id: string;
  nombre: string;
  costo: number;
  envioGratisDesde: number;
  demoraEstimada: string | null;
}

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

export async function listarSucursalesPublicas() {
  return db
    .select({
      id: branches.id,
      slug: branches.slug,
      nombre: branches.name,
      direccion: branches.address,
      horario: branches.hours,
    })
    .from(branches)
    .where(eq(branches.active, true))
    .orderBy(asc(branches.sortOrder));
}

/**
 * Costo de envío de una zona para un monto dado.
 *
 * La promoción de envío gratis se calcula acá y no en la pantalla, para que el
 * precio que se muestra y el que se cobra salgan del mismo lugar.
 */
export function calcularEnvio(zona: ZonaEnvio, subtotal: number): number {
  if (zona.envioGratisDesde > 0 && subtotal >= zona.envioGratisDesde) return 0;
  return zona.costo;
}
