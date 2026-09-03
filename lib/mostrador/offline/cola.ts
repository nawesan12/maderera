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

/** Un ingreso o un retiro de caja hecho sin conexión. */
export interface MovimientoEncolado {
  clave: string;
  branchId: string;
  tipo: "ingreso" | "retiro";
  monto: number;
  motivo: string;
  /** ISO. El momento real, que es el que decide a qué turno pertenece. */
  hechoAt: string;
}

/**
 * La cola lleva dos cosas y no una.
 *
 * Las ventas son el motivo por el que existe, pero un retiro de caja hecho
 * mientras no había internet tiene el mismo problema: la plata salió del cajón
 * y el turno no se enteró. Van por la misma cola porque comparten todo lo
 * difícil —el backoff, el lote, el drenador único, la distinción entre
 * rechazada y reintentar— y se separan recién al mandarlas, que es lo único en
 * lo que difieren.
 */
type FilaDeCola = ItemDeCola &
  (
    | { tipo?: "venta"; venta: VentaEncolada }
    | { tipo: "movimiento"; movimiento: MovimientoEncolado }
  );

/** Las ventas viejas no llevaban `tipo`: sin él, es una venta. */
function esVenta(fila: FilaDeCola): fila is ItemDeCola & { venta: VentaEncolada } {
  return fila.tipo !== "movimiento";
}

const LOTE = 25;

/** Guarda la venta y su ticket juntos, o no guarda ninguno. */
export async function encolarVenta(
  venta: VentaEncolada,
  ticket: DocumentoTicket,
): Promise<void> {
  const fila: FilaDeCola = { ...nuevoItem(venta.clave), tipo: "venta", venta };

  await guardarJunto(["cola", "tickets"], (store) => {
    store("cola").put(fila);
    store("tickets").put({ clave: venta.clave, documento: ticket });
  });
}

/**
 * Encola un movimiento de caja.
 *
 * No lleva ticket: no hay papel que entregar. Lo que sí lleva es el momento en
 * que pasó, porque de eso depende a qué turno va a caer cuando llegue.
 */
export async function encolarMovimiento(
  movimiento: MovimientoEncolado,
): Promise<void> {
  const fila: FilaDeCola = {
    ...nuevoItem(movimiento.clave),
    tipo: "movimiento",
    movimiento,
  };

  await guardarJunto(["cola"], (store) => store("cola").put(fila));
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

    /*
     * Los movimientos de caja van primero y de a uno.
     *
     * De a uno porque son pocos —un retiro por turno, no doscientos— y porque
     * cada uno resuelve su propio turno del lado del servidor. Primero porque
     * si el que falla es un retiro, las ventas no tienen por qué esperarlo.
     */
    for (const fila of listas) {
      if (esVenta(fila)) continue;
      const r = await subirMovimiento(fila.movimiento);

      if (r === "sin_sesion") {
        faltaSesion = true;
        await aplicar(fila, { tipo: "sin_sesion" });
      } else if (r === "ok") {
        subidas += 1;
        await aplicar(fila, { tipo: "sincronizada", numero: fila.clave });
      } else if (r === "rechazado") {
        await aplicar(fila, {
          tipo: "rechazada",
          motivo: "El servidor no aceptó el movimiento.",
        });
      } else {
        await aplicar(fila, { tipo: "reintentar", motivo: r });
      }
    }

    const ventas = listas.filter(esVenta);

    if (ventas.length === 0) {
      const r = resumir(await leerCola());
      return { subidas, pendientes: r.pendientes, atascadas: r.atascadas, faltaSesion };
    }

    try {
      const respuesta = await fetch("/api/mostrador/ventas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ventas: ventas.map((f) => f.venta) }),
      });

      if (respuesta.status === 401) {
        faltaSesion = true;
        for (const fila of ventas) await aplicar(fila, { tipo: "sin_sesion" });
      } else if (!respuesta.ok) {
        for (const fila of ventas) {
          await aplicar(fila, { tipo: "reintentar", motivo: `El servidor contestó ${respuesta.status}.` });
        }
      } else {
        const datos = await respuesta.json();

        for (const fila of ventas) {
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
      for (const fila of ventas) {
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
 * Manda un movimiento de caja. Devuelve el motivo si hay que reintentar.
 *
 * Un 401 y un 400 no son lo mismo y por eso se distinguen: la sesión vencida se
 * arregla volviendo a entrar y la cola retiene todo; un cuerpo mal formado va a
 * fallar igual dentro de una hora, así que reintentarlo sería un bucle.
 */
async function subirMovimiento(
  movimiento: MovimientoEncolado,
): Promise<"ok" | "sin_sesion" | "rechazado" | string> {
  try {
    const respuesta = await fetch("/api/mostrador/caja/movimientos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(movimiento),
    });

    if (respuesta.status === 401) return "sin_sesion";
    if (!respuesta.ok) return `El servidor contestó ${respuesta.status}.`;

    const datos = await respuesta.json();

    if (datos.error === "datos") return "rechazado";

    /*
     * Sin turno donde caer **no se descarta**: se reintenta. Puede que alguien
     * esté por abrir la caja del día y el movimiento encuentre su lugar en
     * cinco minutos. Tirarlo sería perder un retiro que ya se hizo.
     */
    if (datos.error === "sin_turno") {
      return "Todavía no hay ningún turno de caja donde anotarlo.";
    }

    return datos.ok ? "ok" : "El servidor no confirmó el movimiento.";
  } catch {
    return "No hay conexión con el servidor.";
  }
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
