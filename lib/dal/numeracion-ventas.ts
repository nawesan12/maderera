import "server-only";

import { sql } from "drizzle-orm";
import { cuttingOrders, orders, quotes } from "@/lib/db/schema";

type Transaccion = Parameters<
  Parameters<typeof import("@/lib/db").db.transaction>[0]
>[0];

/**
 * Numeración de pedidos y presupuestos, con lock.
 *
 * Es el mismo problema que ya estaba resuelto para los comprobantes fiscales en
 * `lib/fiscal/numeracion.ts`, y la misma solución. Acá faltaba, y no era
 * teórico: dos cajas cobrando en el mismo momento leían el mismo máximo y
 * pedían el mismo `PED-n`. El índice único de `orders.numero` impedía el
 * número repetido —eso funcionaba— pero lo hacía **abortando la segunda venta
 * con un error crudo en la cara del vendedor**, con el cliente enfrente y la
 * mercadería sobre el mostrador. No hay reintento en ningún lado: el comentario
 * que decía "una de las dos falla y vuelve a intentar" describía algo que nadie
 * había escrito.
 *
 * Con el lock, la segunda espera y saca el siguiente número.
 *
 * **Las dos funciones reciben la transacción y no la abren.** Pedir el número
 * antes y usarlo después no sirve: el lock de Postgres vive lo que vive la
 * transacción, así que uno tomado afuera se suelta antes del insert y no
 * protege nada. Por lo mismo, **el insert tiene que ir en esa misma
 * transacción**: el lock no hace magia sobre el número, hace que la segunda
 * transacción espere a que la primera haya insertado y por lo tanto lea un
 * máximo ya actualizado.
 *
 * Medido contra la base, con tres ventas simultáneas: sin lock, una de las tres
 * aborta con `duplicate key value violates unique constraint`; con lock, las
 * tres salen con números consecutivos.
 */

/**
 * Claves de lock, elegidas para no pisar a las que ya usa el proyecto.
 *
 * Los locks consultivos de Postgres comparten **un único espacio de 64 bits**,
 * así que dos partes del sistema que elijan el mismo número se esperan entre sí
 * sin tener nada que ver. No corrompe nada —solo hace esperar— pero es un
 * problema difícil de encontrar si aparece.
 *
 * El mapa de inquilinos, hoy:
 *
 * - `hashtext(...)` —ventas, anulaciones, stock, eventos— devuelve un `int4`:
 *   cae en ±2.147.483.647. Lo usan `lib/mostrador/venta.ts`, `anular.ts`,
 *   `lib/inventario/reservas.ts` y `lib/eventos/index.ts`.
 * - `lib/entregas/index.ts` usa el literal `918273645`, que está adentro de ese
 *   mismo rango.
 * - `lib/fiscal/numeracion.ts` arma `(hash % 1e6) * 1e4 + puntoVenta`: cae en
 *   0…9.999.999.999.
 *
 * Estas dos quedan por encima de todo eso. `tests/numeracion-ventas.test.ts` lo
 * fija, porque es de esas cosas que se rompen en silencio dentro de un año.
 */
const SERIE_PEDIDOS = 1_000_000_000_001;
const SERIE_PRESUPUESTOS = 1_000_000_000_002;
const SERIE_CORTES = 1_000_000_000_003;

export const CLAVES_DE_LOCK = {
  pedidos: SERIE_PEDIDOS,
  presupuestos: SERIE_PRESUPUESTOS,
  cortes: SERIE_CORTES,
} as const;

/**
 * Siguiente `PED-n`.
 *
 * Toma el número más alto usado y no el registro más reciente: un pedido
 * cargado hace un rato puede tener un número menor que otro cargado antes, y
 * ordenar por fecha devuelve un número ya ocupado.
 */
export async function siguienteNumeroDePedido(
  tx: Transaccion,
): Promise<string> {
  await tx.execute(sql`select pg_advisory_xact_lock(${SERIE_PEDIDOS})`);

  const [fila] = await tx
    .select({
      maximo: sql<number>`coalesce(max(nullif(regexp_replace(${orders.numero}, '\\D', '', 'g'), '')::bigint), 999)::int`,
    })
    .from(orders);

  return `PED-${Number(fila?.maximo ?? 999) + 1}`;
}

/** Siguiente `P-AAAA-NNNN`. La serie se reinicia cada año. */
export async function siguienteNumeroDePresupuesto(
  tx: Transaccion,
): Promise<string> {
  await tx.execute(sql`select pg_advisory_xact_lock(${SERIE_PRESUPUESTOS})`);

  const anio = new Date().getFullYear();

  const [fila] = await tx
    .select({
      maximo: sql<number>`coalesce(max(nullif(regexp_replace(${quotes.numero}, '\\D', '', 'g'), '')::bigint % 10000), 0)::int`,
    })
    .from(quotes)
    .where(sql`${quotes.numero} like ${`P-${anio}-%`}`);

  return `P-${anio}-${String((fila?.maximo ?? 0) + 1).padStart(4, "0")}`;
}

/** Siguiente `CRT-n`, la serie de las órdenes de corte del aserradero. */
export async function siguienteNumeroDeCorte(
  tx: Transaccion,
): Promise<string> {
  await tx.execute(sql`select pg_advisory_xact_lock(${SERIE_CORTES})`);

  const [fila] = await tx
    .select({
      maximo: sql<number>`coalesce(max(nullif(regexp_replace(${cuttingOrders.numero}, '\\D', '', 'g'), '')::bigint), 0)::int`,
    })
    .from(cuttingOrders);

  return `CRT-${Number(fila?.maximo ?? 0) + 1}`;
}
