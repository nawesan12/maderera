"use client";

import {
  guardarMeta,
  guardarVarios,
  hayAlmacenLocal,
  leerMeta,
  leerTodo,
} from "./db";
import { clavePrecio, type PreciosLocales } from "./precio-local";
import type { ClienteLocal, VarianteLocal } from "./busqueda-local";

/**
 * Mantener la copia local al día.
 *
 * **Delta, no volcado.** Se guarda cuándo fue la última vez y se piden solo las
 * filas que cambiaron desde entonces: bajar ocho mil variantes cada diez
 * minutos es tráfico y batería que no hacen falta.
 *
 * La pantalla **se dibuja siempre de la copia local primero**, y la
 * sincronización pasa por detrás. Esperar a la red para mostrar el catálogo
 * convierte cada apertura en una pantalla en blanco, que es justo lo que este
 * trabajo viene a sacar.
 */

interface EstadoCatalogo {
  ultimaSincronizacion: string | null;
  listaGeneralId: string | null;
}

/** Cada cuánto se pregunta si cambió algo, con conexión. */
export const CADA_CUANTO_MS = 10 * 60 * 1000;

/** Cada tanto se pide todo de nuevo, por si un `updatedAt` se perdió. */
const RESINCRONIZAR_CADA_MS = 24 * 60 * 60 * 1000;

export interface ResultadoSincronizacion {
  variantes: number;
  precios: number;
  clientes: number;
  desdeCero: boolean;
}

export async function sincronizarCatalogo(
  opciones: { forzarTodo?: boolean } = {},
): Promise<ResultadoSincronizacion | null> {
  if (!hayAlmacenLocal()) return null;

  const estado = await leerMeta<EstadoCatalogo>("catalogo");

  const vencido =
    !estado?.ultimaSincronizacion ||
    Date.now() - new Date(estado.ultimaSincronizacion).getTime() >
      RESINCRONIZAR_CADA_MS;

  const desdeCero = Boolean(opciones.forzarTodo) || vencido;
  const desde = desdeCero ? null : estado?.ultimaSincronizacion ?? null;

  const consulta = desde ? `?desde=${encodeURIComponent(desde)}` : "";

  const [catalogo, padron] = await Promise.all([
    fetch(`/api/mostrador/catalogo${consulta}`).then(leerJson),
    fetch(`/api/mostrador/clientes${consulta}`).then(leerJson),
  ]);

  if (!catalogo || !padron) return null;

  await guardarVarios("variantes", catalogo.variantes);
  await guardarVarios(
    "precios",
    catalogo.precios.map((p: { priceListId: string; variantId: string; precio: number }) => p),
  );
  await guardarVarios("stock", catalogo.stock);
  await guardarVarios("clientes", padron.clientes);

  await guardarMeta<EstadoCatalogo>("catalogo", {
    ultimaSincronizacion: catalogo.generadoAt,
    listaGeneralId:
      catalogo.listas.find((l: { esGeneral: boolean }) => l.esGeneral)?.id ??
      estado?.listaGeneralId ??
      null,
  });

  return {
    variantes: catalogo.variantes.length,
    precios: catalogo.precios.length,
    clientes: padron.clientes.length,
    desdeCero,
  };
}

/** Una respuesta que no es 200 no se interpreta: se devuelve null y se reintenta. */
async function leerJson(respuesta: Response) {
  if (!respuesta.ok) return null;
  return respuesta.json().catch(() => null);
}

/** Todo lo que la pantalla necesita para buscar sin conexión. */
export async function cargarIndices(): Promise<{
  variantes: VarianteLocal[];
  clientes: ClienteLocal[];
  precios: PreciosLocales;
  stock: Map<string, number>;
  listaGeneralId: string | null;
}> {
  const [variantes, clientes, precios, stock, estado] = await Promise.all([
    leerTodo<VarianteLocal>("variantes"),
    leerTodo<ClienteLocal>("clientes"),
    leerTodo<{ priceListId: string; variantId: string; precio: number }>("precios"),
    leerTodo<{ branchId: string; variantId: string; qty: number }>("stock"),
    leerMeta<EstadoCatalogo>("catalogo"),
  ]);

  return {
    variantes,
    clientes,
    precios: new Map(
      precios.map((p) => [clavePrecio(p.priceListId, p.variantId), p.precio]),
    ),
    stock: new Map(stock.map((s) => [`${s.branchId}:${s.variantId}`, s.qty])),
    listaGeneralId: estado?.listaGeneralId ?? null,
  };
}
