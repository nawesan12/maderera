"use client";

import { useEffect, useRef, useState } from "react";
import type { paths } from "@/lib/api/tipos";
import type { PlanoDeCorte, PresupuestoDeCorte } from "@/lib/cortes/tipos";

/**
 * El plano mientras alguien tipea, calculado por Go.
 *
 * El motor era TypeScript y corría en el navegador en cada tecla. Ahora es
 * uno solo, en Go (backend/internal/cortes): el navegador le manda el
 * despiece a /api/v1/cortes/plano y dibuja lo que vuelve. Así el plano que se
 * ve al cargar es, por construcción, el mismo que después se cobra, se
 * imprime y baja al taller.
 *
 * Espera un instante después de la última tecla y cancela el pedido anterior:
 * en un despiece común la respuesta tarda unos milisegundos, y mientras tanto
 * queda dibujado el último plano.
 */
export type PedidoDePlano =
  paths["/api/v1/cortes/plano"]["post"]["requestBody"]["content"]["application/json"];

const ESPERA_MS = 120;

export function planoVacio(placaLargo: number, placaAncho: number, anchoSierra: number): PlanoDeCorte {
  return {
    placaLargo,
    placaAncho,
    anchoSierra,
    placas: [],
    noEntran: [],
    totalPiezas: 0,
    aprovechadoTotal: 0,
    pasadas: 0,
    recorteMayor: null,
    placasEnteras: 0,
    pasadasCobrables: 0,
    fijadasDescartadas: [],
  };
}

/**
 * Un POST a la API de Go que se repite cuando cambia el cuerpo, con espera y
 * cancelación. `null` no pide nada.
 */
export function useDeGo<T>(ruta: string, cuerpo: unknown | null): { datos: T | null; calculando: boolean; error: string | null } {
  const [datos, setDatos] = useState<T | null>(null);
  const [calculando, setCalculando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const clave = cuerpo === null ? null : JSON.stringify(cuerpo);
  const ultimo = useRef<AbortController | null>(null);

  useEffect(() => {
    if (clave === null) return;
    const control = new AbortController();
    ultimo.current?.abort();
    ultimo.current = control;
    const reloj = setTimeout(async () => {
      setCalculando(true);
      try {
        const r = await fetch(ruta, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: clave,
          signal: control.signal,
        });
        const j = await r.json();
        if (control.signal.aborted) return;
        if (!r.ok) {
          setError(j?.errores ? Object.values(j.errores as Record<string, string>)[0] : (j?.detail ?? "No se pudo calcular."));
          return;
        }
        setError(null);
        setDatos(j as T);
      } catch (e) {
        if ((e as Error).name !== "AbortError") setError("No se pudo calcular: revisá la conexión.");
      } finally {
        if (!control.signal.aborted) setCalculando(false);
      }
    }, ESPERA_MS);
    return () => {
      clearTimeout(reloj);
      control.abort();
    };
  }, [ruta, clave]);

  return { datos, calculando, error };
}

/** El plano (y el presupuesto, si se pide) del despiece que se está cargando. */
export function usePlano(pedido: PedidoDePlano): {
  plano: PlanoDeCorte;
  cuenta: PresupuestoDeCorte | null;
  calculando: boolean;
  error: string | null;
} {
  // Con presupuesto se pide aunque no haya piezas: lo que falta para que el
  // precio sea firme («cargá el despiece») lo dice Go.
  const conPiezas = pedido.piezas.length > 0 || pedido.presupuesto !== undefined;
  const { datos, calculando, error } = useDeGo<{ plano: PlanoDeCorte; cuenta?: PresupuestoDeCorte }>(
    "/api/v1/cortes/plano",
    conPiezas ? pedido : null,
  );
  const vacio = planoVacio(pedido.placaLargo, pedido.placaAncho, pedido.anchoSierra ?? 5);
  if (!conPiezas) return { plano: vacio, cuenta: null, calculando: false, error: null };
  return { plano: datos?.plano ?? vacio, cuenta: datos?.cuenta ?? null, calculando, error };
}

/** Las piezas como las pide el plano: solo lo que el contrato acepta. */
export function piezasParaElPlano(
  piezas: {
    largoMm: number;
    anchoMm: number;
    cantidad: number;
    respetaVeta: number;
    etiqueta?: string | null;
    cantoLargo?: number;
    cantoAncho?: number;
  }[],
): PedidoDePlano["piezas"] {
  return piezas.map((p) => ({
    largoMm: p.largoMm,
    anchoMm: p.anchoMm,
    cantidad: p.cantidad,
    respetaVeta: p.respetaVeta,
    etiqueta: p.etiqueta ?? null,
    cantoLargo: p.cantoLargo ?? 0,
    cantoAncho: p.cantoAncho ?? 0,
  }));
}
