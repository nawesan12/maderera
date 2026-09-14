/**
 * Qué se le cobra a alguien que pide un corte.
 *
 * No es "las pasadas por la tarifa". El precio sale de mirar el plano placa por
 * placa, porque de cada una puede salir una cosa distinta:
 *
 * - **De la que sale más de la mitad**, se vende la placa entera y el corte va
 *   sin cargo. El cliente ya pagó todo el material; cobrarle además las pasadas
 *   sería cobrarle dos veces la misma placa.
 * - **De la que sale menos de la mitad**, se cobra el corte por pasada y el
 *   material que se llevó. El sobrante queda en la maderera y sirve.
 *
 * Y aparte el tapacanto, que se cobra por metro y no depende del acomodo.
 *
 * Lógica pura, sin base de datos: la tarifa y el precio de la placa entran por
 * argumento porque dependen de la lista del cliente, y eso lo resuelve el DAL.
 */

import type { PlanoDeCorte } from "@/lib/cortes/plano";
import {
  cargoPorCorte,
  cargoPorTapacanto,
  metrosDeTapacanto,
  type TarifaDeCorte,
} from "@/lib/cortes/tarifa";

/**
 * Una pieza como la conoce el presupuesto.
 *
 * El canto es opcional porque así llega desde el despiece —una pieza sin canto
 * no lo declara— y acá se normaliza a cero antes de medir metros.
 */
export interface PiezaPresupuestada {
  largoMm: number;
  anchoMm: number;
  cantidad: number;
  cantoLargo?: number;
  cantoAncho?: number;
}

export interface PresupuestoDeCorte {
  /** Placas que se le venden enteras porque sale de ellas más de la mitad. */
  placasEnteras: number;
  precioPorPlaca: number;
  subtotalPlacas: number;
  /** Pasadas de las placas que no se venden enteras. */
  pasadasCobrables: number;
  precioPorPasada: number;
  subtotalCorte: number;
  metrosCanto: number;
  subtotalCanto: number;
  total: number;
  /**
   * Qué falta para que el precio sea firme. Vacío significa que ya lo es.
   *
   * Acá van solo los **problemas**. Hubo una lista hermana, `explicacion`, que
   * narraba el porqué del precio —"de dos placas sale más de la mitad, así que
   * se venden enteras"— y se sacó: cada línea repetía un número que la pantalla
   * ya mostraba dos veces, y cuatro párrafos seguidos en una ficha que se lee
   * de pie son una pared. Lo que el texto describía ahora se ve dibujado, con
   * la decisión escrita en cada placa.
   */
  faltan: string[];
}

export function presupuestarCorte({
  plano,
  tarifa,
  precioPorPlaca,
  piezas,
}: {
  plano: PlanoDeCorte;
  tarifa: TarifaDeCorte | null;
  /** Precio final de una placa, con IVA, en la lista que le toca al cliente. */
  precioPorPlaca: number | null;
  piezas: PiezaPresupuestada[];
}): PresupuestoDeCorte {
  const placasEnteras = plano.placasEnteras;
  const precioPlaca = precioPorPlaca ?? 0;
  const subtotalPlacas = redondear(placasEnteras * precioPlaca);

  const pasadasCobrables = plano.pasadasCobrables;
  const subtotalCorte = cargoPorCorte(tarifa, pasadasCobrables);

  const metrosCanto = metrosDeTapacanto(
    piezas.map((p) => ({
      largoMm: p.largoMm,
      anchoMm: p.anchoMm,
      cantidad: p.cantidad,
      cantoLargo: p.cantoLargo ?? 0,
      cantoAncho: p.cantoAncho ?? 0,
    })),
  );
  const subtotalCanto = cargoPorTapacanto(tarifa, metrosCanto);

  const faltan: string[] = [];

  if (plano.placas.length === 0) {
    faltan.push("Cargá el despiece: sin piezas no hay plano ni precio.");
  }

  if (plano.noEntran.length > 0) {
    faltan.push(
      plano.noEntran.length === 1
        ? "Hay una pieza que no entra en la placa."
        : `Hay ${plano.noEntran.length} piezas que no entran en la placa.`,
    );
  }

  // El precio de la placa solo hace falta si hay alguna que se venda entera.
  if (placasEnteras > 0 && !precioPorPlaca) {
    faltan.push(
      "Falta el precio de la placa: sin eso no se puede cobrar el material.",
    );
  }

  // Y la tarifa solo si queda alguna placa de la que se cobre el corte.
  const sueltas = plano.placas.length - placasEnteras;
  if (sueltas > 0 && !tarifa) {
    faltan.push(
      "No hay tarifa de corte cargada para este material. Se configura en Cortes.",
    );
  }

  return {
    placasEnteras,
    precioPorPlaca: precioPlaca,
    subtotalPlacas,
    pasadasCobrables,
    precioPorPasada: tarifa?.precioPorPasada ?? 0,
    subtotalCorte,
    metrosCanto,
    subtotalCanto,
    total: redondear(subtotalPlacas + subtotalCorte + subtotalCanto),
    faltan,
  };
}

function redondear(v: number): number {
  return Math.round(v * 100) / 100;
}
