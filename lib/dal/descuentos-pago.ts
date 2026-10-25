import "server-only";

import { cache } from "react";
import { apiPublica, datos } from "@/lib/api/servidor";
import type { EscalaDePago } from "@/lib/precios/medio-pago";
import { cachearPublico, ETIQUETAS } from "@/lib/cache-publico";

/**
 * Las escalas de descuento por medio de pago, activas.
 *
 * **Esta es la que cobra.** Request-time y sin caché compartido: es un número
 * que el panel cambia y tiene que valer en la venta siguiente, no en cinco
 * minutos. La usan el carrito y el mostrador, donde una escala vieja no es un
 * texto desactualizado sino plata mal cobrada. Son pocas filas y la consulta se
 * memoiza por request.
 *
 * Para *anunciar* el descuento —la franja de la portada— está
 * `escalasDePagoPublicas`, que es la misma consulta cacheada.
 */
export const escalasDePago = cache(async (): Promise<EscalaDePago[]> =>
  datos(await apiPublica.GET("/api/v1/contenido/escalas-pago")),
);

export const escalasDePagoPublicas = cachearPublico(
  () => escalasDePago(),
  ["escalas-de-pago-publicas"],
  ETIQUETAS.contenido,
);
