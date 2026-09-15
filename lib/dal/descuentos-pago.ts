import "server-only";

import { cache } from "react";
import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { paymentDiscounts } from "@/lib/db/schema";
import type { EscalaDePago } from "@/lib/precios/medio-pago";
import { cachearPublico, ETIQUETAS } from "@/lib/cache-publico";

/**
 * Las escalas de descuento por medio de pago, activas.
 *
 * **Esta es la que cobra.** Request-time y sin caché compartido: es un número
 * que el panel cambia y tiene que valer en la venta siguiente, no en cinco
 * minutos. La usan el checkout y el mostrador, donde una escala vieja no es un
 * texto desactualizado sino plata mal cobrada. Son pocas filas y la consulta se
 * memoiza por request.
 *
 * Para *anunciar* el descuento —la franja de la portada— está
 * `escalasDePagoPublicas`, que es la misma consulta cacheada.
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

/**
 * Las mismas escalas, para anunciarlas.
 *
 * La portada dice «10 % por transferencia» y eso no cobra nada: es un cartel.
 * Cacheado, esa página deja de hacer una consulta por visita —era la única que
 * le quedaba— y pasa a servirse entera de datos ya calculados.
 *
 * Comparte la consulta con `escalasDePago` a propósito: si algún día cambia lo
 * que se anuncia, cambia también lo que se cobra, y no al revés.
 *
 * Lleva la etiqueta del contenido del sitio, así que el panel la invalida junto
 * con el resto cuando alguien edita. El vencimiento de cinco minutos es la red
 * de seguridad.
 */
export const escalasDePagoPublicas = cachearPublico(
  () => escalasDePago(),
  ["escalas-de-pago-publicas"],
  ETIQUETAS.contenido,
);
