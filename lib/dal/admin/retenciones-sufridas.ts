import "server-only";

import { api, datos } from "@/lib/api/servidor";

/**
 * Las retenciones que nos practicaron.
 *
 * **Bajan lo que el cliente debe.** Pagó $95 y trajo un certificado por $5: la
 * cuenta se salda en $100. Tratarlo como un descuento comercial lo sacaría del
 * crédito fiscal, que es plata que se recupera contra el impuesto —no un
 * descuento que se regaló—.
 */

/*
 * Las lecturas las sirve la API de Go (backend/internal/compras); la carga,
 * que emite un recibo, la hace backend/internal/cobros
 * (app/admin/arca/retenciones/actions.ts).
 */

export async function listarRetencionesSufridas(limite = 60) {
  const filas = datos(
    await (await api()).GET("/api/v1/admin/compras/retenciones-sufridas", { params: { query: { limite } } }),
  );
  return filas.map((f) => ({ ...f, fecha: new Date(f.fecha) }));
}

/**
 * El crédito por retenciones sufridas de un período, por impuesto: la de
 * Ganancias no se puede aplicar contra el IVA.
 */
export async function creditoPorRetenciones(desde: Date, hasta: Date) {
  return datos(
    await (await api()).GET("/api/v1/admin/compras/retenciones-sufridas/credito", {
      params: { query: { desde: desde.toISOString(), hasta: hasta.toISOString() } },
    }),
  );
}
