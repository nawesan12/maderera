import "server-only";

import { cache } from "react";
import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { paymentDiscounts } from "@/lib/db/schema";
import type { EscalaDePago } from "@/lib/precios/medio-pago";

/**
 * Las escalas de descuento por medio de pago, activas.
 *
 * Request-time y sin `use cache`: es un número que el mostrador cambia y tiene
 * que verse en la venta siguiente, no en el próximo despliegue. Son pocas
 * filas y la consulta se memoiza por request.
 */
export const escalasDePago = cache(async (): Promise<EscalaDePago[]> => {
  const filas = await db
    .select({
      medio: paymentDiscounts.medio,
      desdeMonto: paymentDiscounts.desdeMonto,
      porcentaje: paymentDiscounts.porcentaje,
      etiqueta: paymentDiscounts.etiqueta,
    })
    .from(paymentDiscounts)
    .where(eq(paymentDiscounts.activo, true))
    .orderBy(asc(paymentDiscounts.medio), asc(paymentDiscounts.desdeMonto));

  return filas.map((f) => ({
    medio: f.medio,
    desdeMonto: Number(f.desdeMonto),
    porcentaje: Number(f.porcentaje),
    etiqueta: f.etiqueta,
  }));
});
