"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import { CANALES, type Canal, type EventoEnVivo } from "./canales";

/**
 * Escuchar los avisos en vivo desde un componente.
 *
 * **Una sola conexión por pestaña**, compartida: la bandeja, el aviso de
 * pedidos nuevos y la cola del taller pueden estar a la vez en pantalla, y
 * cada `EventSource` es una conexión abierta contra el servidor. Esta se abre
 * con el primer componente que escucha y se cierra con el último.
 *
 * Devuelve si está conectada. Las pantallas lo usan para decidir si siguen
 * consultando cada tanto: sin tiempo real (Vercel contesta 204, o se cortó),
 * vuelven a lo de siempre en vez de quedarse quietas.
 */
type Aviso = EventoEnVivo | { canal: "reconexion" };
type Oyente = (aviso: Aviso) => void;

const oyentes = new Set<Oyente>();
const suscriptores = new Set<() => void>();
let fuente: EventSource | null = null;
let conectado = false;
let reintento: ReturnType<typeof setTimeout> | null = null;
let espera = 30_000;

function cambiarConexion(valor: boolean) {
  if (conectado === valor) return;
  conectado = valor;
  for (const avisar of suscriptores) avisar();
}

function abrir() {
  if (fuente || typeof EventSource === "undefined") return;

  const nueva = new EventSource("/api/vivo");
  fuente = nueva;

  nueva.onopen = () => {
    espera = 30_000;
    cambiarConexion(true);
  };

  nueva.onerror = () => {
    cambiarConexion(false);
    // CONNECTING: el navegador ya está reintentando solo (se cortó la red).
    // CLOSED: el servidor contestó algo que no es un flujo —204 donde no hay
    // tiempo real, 401, 503—. Se vuelve a probar más tarde, cada vez más
    // espaciado, por si fue un corte de la base.
    if (nueva.readyState === EventSource.CLOSED) {
      fuente = null;
      if (oyentes.size > 0 && !reintento) {
        reintento = setTimeout(() => {
          reintento = null;
          if (oyentes.size > 0) abrir();
        }, espera);
        espera = Math.min(espera * 2, 10 * 60_000);
      }
    }
  };

  for (const canal of [...CANALES, "reconexion"] as const) {
    nueva.addEventListener(canal, (mensaje) => {
      let datos: object = {};
      try {
        datos = JSON.parse((mensaje as MessageEvent<string>).data) as object;
      } catch {
        // Sin datos el aviso igual sirve: «algo cambió en este canal».
      }
      const aviso = { ...datos, canal } as Aviso;
      for (const oyente of oyentes) oyente(aviso);
    });
  }
}

function cerrarSiNadieEscucha() {
  if (oyentes.size > 0) return;
  fuente?.close();
  fuente = null;
  if (reintento) clearTimeout(reintento);
  reintento = null;
  cambiarConexion(false);
}

export function useEnVivo(
  canales: readonly Canal[],
  alEvento: (aviso: Aviso) => void,
): boolean {
  // El último callback, sin reabrir la suscripción en cada render.
  const ultimo = useRef(alEvento);
  useEffect(() => {
    ultimo.current = alEvento;
  });

  const clave = canales.join(",");

  useEffect(() => {
    const quiero = new Set<string>(clave.split(","));
    const oyente: Oyente = (aviso) => {
      if (aviso.canal === "reconexion" || quiero.has(aviso.canal)) ultimo.current(aviso);
    };
    oyentes.add(oyente);
    abrir();
    return () => {
      oyentes.delete(oyente);
      cerrarSiNadieEscucha();
    };
  }, [clave]);

  return useSyncExternalStore(
    (avisar) => {
      suscriptores.add(avisar);
      return () => suscriptores.delete(avisar);
    },
    () => conectado,
    () => false,
  );
}
