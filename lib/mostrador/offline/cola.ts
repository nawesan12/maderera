"use client";

import { borrar, guardarJunto, leerTodo, type Almacen } from "./db";
import {
  estaListo,
  nuevoItem,
  reducirCola,
  resumir,
  type EventoDeCola,
  type ItemDeCola,
  type ResumenDeCola,
} from "./cola-estado";
import type { DocumentoTicket } from "../ticket";

/**
 * La cola de ventas que todavía no llegaron al servidor.
 *
 * Guarda **la venta y su ticket en la misma transacción**: el papel existe en
 * el mismo instante que la venta. Un ticket sin venta en la cola sería un papel
 * entregado que nunca se va a cobrar; una venta sin ticket es un cliente que se
 * va sin nada en la mano.
 *
 * Un solo drenador a la vez, con `navigator.locks`. La idempotencia del
 * servidor ya cubre la corrección —mandar dos veces la misma venta devuelve el
 * mismo pedido—, pero dos pestañas drenando en paralelo es ruido que no aporta.
 */

export interface VentaEncolada {
  clave: string;
  numeroProvisorio: string;
  branchId: string;
  lineas: {
    variantId: string | null;
    descripcion: string;
    unidad: string;
    cantidad: number;
    precioUnitario: number;
  }[];
  customerId: string | null;
  contactoNombre: string;
  contactoTelefono?: string | null;
  medioPago: string;
  comprobante: "interno" | "fiscal";
  cuit?: string | null;
  descuento?: number;
  descuentoMotivo?: string | null;
  notas?: string | null;
  usuarioId: string;
  /** ISO. La hora real del mostrador. */
  cobradaAt: string;
}

interface FilaDeCola extends ItemDeCola {
  venta: VentaEncolada;
}

const LOTE = 25;

/** Guarda la venta y su ticket juntos, o no guarda ninguno. */
export async function encolarVenta(
  venta: VentaEncolada,
  ticket: DocumentoTicket,
): Promise<void> {
  const fila: FilaDeCola = { ...nuevoItem(venta.clave), venta };

  await guardarJunto(["cola", "tickets"], (store) => {
    store("cola").put(fila);
    store("tickets").put({ clave: venta.clave, documento: ticket });
  });
}

export async function leerCola(): Promise<FilaDeCola[]> {
  return leerTodo<FilaDeCola>("cola");
}

export async function resumenDeCola(): Promise<ResumenDeCola> {
  return resumir(await leerCola());
}

/** Saca de la cola una venta que todavía no salió. Es lo que permite deshacer. */
export async function descartarSiSigueLocal(clave: string): Promise<boolean> {
  const filas = await leerCola();
  const fila = filas.find((f) => f.clave === clave);

  // Confirmada o en vuelo ya no se puede descartar: para eso está anular.
  if (!fila || fila.estado === "confirmada" || fila.estado === "enviando") {
    return false;
  }

  await guardarJunto(["cola", "tickets"], (store) => {
    store("cola").delete(clave);
    store("tickets").delete(clave);
  });

  return true;
}

async function aplicar(fila: FilaDeCola, evento: EventoDeCola): Promise<FilaDeCola> {
  const actualizada: FilaDeCola = { ...fila, ...reducirCola(fila, evento) };
  await guardarJunto(["cola"], (store) => store("cola").put(actualizada));
  return actualizada;
}

export interface ResultadoDrenaje {
  subidas: number;
  pendientes: number;
  atascadas: number;
  /** Vencida la sesión: la cola retiene todo y hay que volver a entrar. */
  faltaSesion: boolean;
}

/**
 * Sube lo que se pueda.
 *
 * Devuelve `null` si otro drenaje está corriendo: no es un error, es que ya se
 * está haciendo.
 */
export async function drenar(): Promise<ResultadoDrenaje | null> {
  if (typeof navigator === "undefined") return null;

  const correr = async (): Promise<ResultadoDrenaje> => {
    const ahora = Date.now();
    const todas = await leerCola();
    const listas = todas.filter((f) => estaListo(f, ahora)).slice(0, LOTE);

    if (listas.length === 0) {
      const r = resumir(todas);
      return { subidas: 0, pendientes: r.pendientes, atascadas: r.atascadas, faltaSesion: false };
    }

    // En vuelo, para que otra pestaña no las mande de nuevo.
    for (const fila of listas) await aplicar(fila, { tipo: "enviando" });

    let faltaSesion = false;
    let subidas = 0;

    try {
      const respuesta = await fetch("/api/mostrador/ventas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ventas: listas.map((f) => f.venta) }),
      });

      if (respuesta.status === 401) {
        faltaSesion = true;
        for (const fila of listas) await aplicar(fila, { tipo: "sin_sesion" });
      } else if (!respuesta.ok) {
        for (const fila of listas) {
          await aplicar(fila, { tipo: "reintentar", motivo: `El servidor contestó ${respuesta.status}.` });
        }
      } else {
        const datos = await respuesta.json();

        for (const fila of listas) {
          const r = datos.resultados?.find(
            (x: { clave: string }) => x.clave === fila.clave,
          );

          if (!r) {
            // El servidor no dijo nada de esta venta: se reintenta, nunca se
            // da por buena.
            await aplicar(fila, { tipo: "reintentar", motivo: "Sin respuesta para esta venta." });
            continue;
          }

          if (r.estado === "sincronizada") {
            subidas += 1;
            await aplicar(fila, {
              tipo: "sincronizada",
              numero: r.numero,
              orderId: r.orderId,
              invoiceId: r.invoiceId,
            });
            await actualizarTicket(fila.clave, r.numero);
          } else {
            await aplicar(fila, { tipo: r.estado, motivo: r.motivo });
          }
        }
      }
    } catch {
      for (const fila of listas) {
        await aplicar(fila, { tipo: "reintentar", motivo: "No hay conexión con el servidor." });
      }
    }

    const despues = resumir(await leerCola());
    return {
      subidas,
      pendientes: despues.pendientes,
      atascadas: despues.atascadas,
      faltaSesion,
    };
  };

  if (!navigator.locks) return correr();

  return navigator.locks.request(
    "mostrador-drenaje",
    { ifAvailable: true },
    async (lock) => (lock ? correr() : null),
  );
}

/**
 * El ticket guardado pasa a mostrar el número definitivo.
 *
 * Se conserva el provisorio como referencia: quien vuelve con el papel viejo
 * tiene que poder encontrarse.
 */
async function actualizarTicket(clave: string, numero: string): Promise<void> {
  const filas = await leerTodo<{ clave: string; documento: DocumentoTicket }>("tickets");
  const fila = filas.find((f) => f.clave === clave);
  if (!fila) return;

  await guardarJunto(["tickets"], (store) =>
    store("tickets").put({
      clave,
      documento: {
        ...fila.documento,
        numero,
        provisorio: false,
        numeroProvisorio: fila.documento.numero,
      },
    }),
  );
}

/** Las confirmadas viejas se limpian: la cola no es un historial. */
export async function limpiarConfirmadas(masViejasQueMs = 24 * 60 * 60 * 1000): Promise<number> {
  const filas = await leerCola();
  const corte = Date.now() - masViejasQueMs;
  let borradas = 0;

  for (const fila of filas) {
    if (fila.estado === "confirmada" && fila.proximoIntentoAt < corte) {
      await borrar("cola" as Almacen, fila.clave);
      borradas += 1;
    }
  }

  return borradas;
}
