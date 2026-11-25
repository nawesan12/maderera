import "server-only";

import { cacheLife, cacheTag, revalidateTag } from "next/cache";
import { apiInterna, datos } from "@/lib/api/servidor";
import { esUuid } from "@/lib/uuid";

/**
 * Si algo existe, desde la caché, para decidir el 404 **antes** de mandar nada.
 *
 * Con Cache Components, cualquier `<Suspense>` —un `loading.tsx`, o el que pone
 * la página— hace que el esqueleto salga primero, y con él el código 200. Lo que
 * se resuelve detrás ya no puede cambiarlo: un `notFound()` ahí adentro pinta la
 * pantalla de «no encontrado» y agrega un `noindex`, pero la respuesta sigue
 * siendo 200. Es un «soft 404»: para un buscador, para un monitor o para quien
 * mire la pestaña de red, la página existe.
 *
 * La salida es la misma que usan la ficha del producto y la del evento: una
 * pregunta barata y cacheada —«¿existe?»— que la página hace fuera de cualquier
 * `<Suspense>`, y recién después el resto, que sí depende de quién mira. Cacheada
 * porque una consulta suelta fuera de un `<Suspense>` es justamente lo que el
 * build no deja hacer.
 *
 * **Esto no decide acceso.** Que algo exista no quiere decir que quien pregunta
 * lo pueda ver: cada página sigue haciendo su propio control —token, sesión,
 * dueño— detrás del `<Suspense>`, y si no corresponde llama a `notFound()`
 * igual que antes. Lo único que cambia es que lo que no existe da un 404 de
 * verdad.
 *
 * **Lo que sí cuenta:** que un número o un id existe. Para todo lo de acá eso no
 * es un secreto, o no se puede adivinar —ver cada caso en `CONSULTAS`—.
 */

/**
 * Qué se puede preguntar, y contra qué columna.
 *
 * Una función sola en lugar de una por tabla porque la regla es la misma para
 * todas y conviene que se lea una vez. Lo que va por uuid se descarta antes de
 * consultar: Postgres rechaza un texto que no tiene forma de uuid con un error,
 * y ese error terminaba en la pantalla de «se nos rompió algo» —un 500 de
 * hecho— en vez de un 404.
 */
/*
 * La consulta la hace la API de Go (backend/internal/existencia), con el
 * secreto interno: abierta, dejaría recorrer los números de pedido. La caché
 * y su invalidación son de Next y quedan acá. `uuid` dice qué claves tienen
 * que ser un uuid para ni preguntar.
 */
const CONSULTAS = {
  "pedido-por-numero": { uuid: false },
  "pago-demo": { uuid: true },
  "remito-por-token": { uuid: false },
  comprobante: { uuid: true },
  remito: { uuid: true },
  cliente: { uuid: true },
  corte: { uuid: true },
  pedido: { uuid: true },
} as const;

const MUESTRAS_DEL_BUILD = new Set(["0", "sin-remito", "00000000-0000-0000-0000-000000000000"]);

export type QueExiste = keyof typeof CONSULTAS;

/** La etiqueta de una entrada: sirve para borrar el «no existe» de algo que se acaba de crear. */
export function etiquetaDeExistencia(que: QueExiste, clave: string): string {
  return `existe:${que}:${clave}`;
}

/** Si la clave tiene la forma que la columna acepta. Exportada para los tests. */
export function claveValida(que: QueExiste, clave: string): boolean {
  if (!clave || clave.length > 200) return false;
  return CONSULTAS[que].uuid ? esUuid(clave) : true;
}

export async function existe(que: QueExiste, clave: string): Promise<boolean> {
  "use cache";
  cacheTag(etiquetaDeExistencia(que, clave));
  // Lo que existe no deja de existir —los pedidos se anulan, no se borran—, así
  // que la entrada puede durar. Si algún día algo se borra, la página lo
  // descubre adentro y cae en la misma pantalla de no encontrado, con 200.
  cacheLife("days");

  if (!claveValida(que, clave)) return false;
  // Las muestras de `generateStaticParams` («0», «sin-remito», el uuid en
  // ceros) no son de nadie, y en el build la API no está a mano: no se pregunta.
  if (MUESTRAS_DEL_BUILD.has(clave) || process.env.NEXT_PHASE === "phase-production-build") return false;

  return datos(await apiInterna.GET("/api/v1/interno/existe", { params: { query: { que, clave } } })).existe;
}

/**
 * Borra el «no existe» de un pedido recién creado.
 *
 * **Hace falta por los números de pedido**, que son consecutivos: si alguien
 * —un bot que recorre la secuencia, o la misma persona recargando— pidió
 * `/pedido/1235` antes de que existiera, la caché guardó que no existe. Sin
 * esto, quien compra y llega a su seguimiento vería un 404 hasta que la entrada
 * venciera. Con `expire: 0` y no con `"max"`: el próximo pedido tiene que ver el
 * dato nuevo, no el viejo mientras se renueva por detrás.
 *
 * Los uuid y los tokens no lo necesitan: nadie pide uno antes de que exista.
 *
 * Nunca hace fallar la venta. Afuera de un pedido de Next —un script, un
 * test— `revalidateTag` tira, y que la caché no se entere no es razón para
 * perder un pedido ya confirmado.
 */
export function avisarPedidoNuevo(numero: string): void {
  try {
    revalidateTag(etiquetaDeExistencia("pedido-por-numero", numero), { expire: 0 });
  } catch {
    // Sin caché de Next alrededor no hay nada que borrar.
  }
}
