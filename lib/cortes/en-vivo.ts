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
 * Si lo que se ve todavía no es la respuesta de lo cargado: desde que cambia
 * el cuerpo, no desde que sale el pedido. Durante la espera el plano dibujado
 * era el anterior y `calculando` decía que no, así que un Ctrl+Enter rápido
 * en el corte —o reabrirlo con «Corregir», con el plano todavía vacío—
 * agregaba renglones de otro plano, y Go rechazaba la venta (revisión del
 * carril F).
 */
export function estaCalculando(clave: string | null, respondida: string | null): boolean {
  return clave !== null && clave !== respondida;
}

/**
 * Un POST a la API de Go que se repite cuando cambia el cuerpo, con espera y
 * cancelación. `null` no pide nada.
 */
export function useDeGo<T>(ruta: string, cuerpo: unknown | null): { datos: T | null; calculando: boolean; error: string | null } {
  const [datos, setDatos] = useState<T | null>(null);
  // El cuerpo de la última respuesta (o error) que llegó.
  const [respondida, setRespondida] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const clave = cuerpo === null ? null : JSON.stringify(cuerpo);
  const calculando = estaCalculando(clave, respondida);
  const ultimo = useRef<AbortController | null>(null);

  useEffect(() => {
    if (clave === null) return;
    const control = new AbortController();
    ultimo.current?.abort();
    ultimo.current = control;
    const reloj = setTimeout(async () => {
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
        if (!control.signal.aborted) setRespondida(clave);
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
  /**
   * Lo que se cobra, que con piezas acomodadas a mano puede no ser lo que se
   * dibuja: Go cobra el plano libre salvo que el manual gaste más placas
   * (cortes.ACobrar). Es lo que vuelve a calcular al cobrar.
   */
  placasACobrar: number;
  pasadasACobrar: number;
  /** Las placas que no pasan la mitad: no se venden, se cobra su corte. */
  placasParciales: number;
  /** Con `variantId` (el panel): la pasada con la tarifa de la placa. */
  precioPorPasada: number | null;
  calculando: boolean;
  error: string | null;
} {
  // Con presupuesto se pide aunque no haya piezas: lo que falta para que el
  // precio sea firme («cargá el despiece») lo dice Go.
  const conPiezas = pedido.piezas.length > 0 || pedido.presupuesto !== undefined;
  const { datos, calculando, error } = useDeGo<{
    plano: PlanoDeCorte;
    cuenta?: PresupuestoDeCorte;
    placasACobrar?: number;
    pasadasACobrar?: number;
    placasParciales?: number;
    precioPorPasada?: number;
  }>("/api/v1/cortes/plano", conPiezas ? pedido : null);
  const vacio = planoVacio(pedido.placaLargo, pedido.placaAncho, pedido.anchoSierra ?? 5);
  if (!conPiezas) {
    return { plano: vacio, cuenta: null, placasACobrar: 0, pasadasACobrar: 0, placasParciales: 0, precioPorPasada: null, calculando: false, error: null };
  }
  const plano = datos?.plano ?? vacio;
  return {
    plano,
    cuenta: datos?.cuenta ?? null,
    placasACobrar: datos?.placasACobrar ?? plano.placasEnteras,
    pasadasACobrar: datos?.pasadasACobrar ?? plano.pasadasCobrables,
    placasParciales: datos?.placasParciales ?? Math.max(0, plano.placas.length - plano.placasEnteras),
    precioPorPasada: datos?.precioPorPasada ?? null,
    calculando,
    error,
  };
}

type Calculado = { plano: PlanoDeCorte; cuenta?: PresupuestoDeCorte } | { error: string };

/**
 * Los planos de varios despieces a la vez: el armador del sitio con varias
 * placas en el mismo pedido. La cantidad de grupos cambia, así que no puede
 * ser un `usePlano` por grupo; acá se pide a Go solo el grupo que cambió (lo
 * ya calculado queda guardado por su cuerpo) y, mientras llega, cada grupo
 * sigue mostrando su último plano.
 */
export function usePlanos(pedidos: PedidoDePlano[]): {
  planos: PlanoDeCorte[];
  cuentas: (PresupuestoDeCorte | null)[];
  calculando: boolean;
} {
  const claves = pedidos.map((p) => JSON.stringify(p));
  const todas = JSON.stringify(claves);
  const [hechos, setHechos] = useState<{ porClave: Record<string, Calculado>; porIndice: Calculado[] }>({
    porClave: {},
    porIndice: [],
  });
  const pendientes = claves.filter((k) => !(k in hechos.porClave));
  const faltan = JSON.stringify([...new Set(pendientes)]);

  useEffect(() => {
    const pedir = JSON.parse(faltan) as string[];
    if (pedir.length === 0) return;
    const control = new AbortController();
    const reloj = setTimeout(async () => {
      const llegados = await Promise.all(
        pedir.map(async (cuerpo): Promise<[string, Calculado] | null> => {
          try {
            const r = await fetch("/api/v1/cortes/plano", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: cuerpo,
              signal: control.signal,
            });
            const j = await r.json();
            if (r.ok) return [cuerpo, j];
            return [cuerpo, { error: j?.detail ?? "No se pudo calcular." }];
          } catch (e) {
            if ((e as Error).name === "AbortError") return null;
            return [cuerpo, { error: "No se pudo calcular: revisá la conexión." }];
          }
        }),
      );
      if (control.signal.aborted) return;
      const vigentes = JSON.parse(todas) as string[];
      setHechos((previo) => {
        // Solo se guarda lo que sigue en pantalla: lo demás ya no se dibuja.
        const porClave: Record<string, Calculado> = {};
        for (const k of vigentes) if (k in previo.porClave) porClave[k] = previo.porClave[k]!;
        for (const l of llegados) if (l) porClave[l[0]] = l[1];
        const porIndice = vigentes.map((k, i) => {
          const r = porClave[k];
          return r && !("error" in r) ? r : previo.porIndice[i];
        });
        return { porClave, porIndice: porIndice as Calculado[] };
      });
    }, ESPERA_MS);
    return () => {
      clearTimeout(reloj);
      control.abort();
    };
  }, [faltan, todas]);

  const planos: PlanoDeCorte[] = [];
  const cuentas: (PresupuestoDeCorte | null)[] = [];
  pedidos.forEach((p, i) => {
    const propio = hechos.porClave[claves[i]!];
    const ultimo = propio && !("error" in propio) ? propio : hechos.porIndice[i];
    const bueno = ultimo && !("error" in ultimo) ? ultimo : null;
    planos.push(bueno?.plano ?? planoVacio(p.placaLargo, p.placaAncho, p.anchoSierra ?? 5));
    cuentas.push(bueno?.cuenta ?? null);
  });
  return { planos, cuentas, calculando: pendientes.length > 0 };
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
