import "server-only";

import { cache } from "react";
import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { cuttingRates } from "@/lib/db/schema";
import type { TarifaDeCorte } from "@/lib/cortes/tarifa";

/**
 * Las tarifas de corte activas.
 *
 * Request-time y sin `use cache`: es un precio que el negocio cambia y tiene
 * que valer para el trabajo siguiente. Son cuatro filas.
 */
export const tarifasDeCorte = cache(async (): Promise<TarifaDeCorte[]> => {
  const filas = await db
    .select({
      material: cuttingRates.material,
      priceListId: cuttingRates.priceListId,
      precioPorPasada: cuttingRates.precioPorPasada,
    })
    .from(cuttingRates)
    .where(eq(cuttingRates.activo, true))
    .orderBy(asc(cuttingRates.material));

  return filas.map((f) => ({
    material: f.material,
    priceListId: f.priceListId,
    precioPorPasada: Number(f.precioPorPasada),
  }));
});
