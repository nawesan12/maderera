import type { Circuito } from "@/lib/circuito";

/** Un cheque recibido que sigue en la cartera. */
export interface ChequeDeCartera {
  id: string;
  numero: string;
  banco: string | null;
  fechaPago: Date | string;
  importe: number;
  /** Físico o e-Cheq: al endosar hay que ofrecer el que corresponde. */
  tipo: string;
  cliente: string | null;
  /** En qué circuito está el valor (lo decide Go: fragmentos.CircuitoDelCheque). */
  circuito: Circuito;
  /** De una venta con su factura esperando el CAE. */
  esperaCae?: boolean;
  /** Espera el CAE y la regla «endoso_espera_cae» no lo deja endosar todavía. */
  trabado?: boolean;
}

/** Lo que este módulo necesita de un renglón del pago. */
export interface RenglonConCheque {
  medio: string;
  importe: string;
  chequeId: string;
}

/**
 * Los cheques de cartera de un renglón: los que se pueden endosar (del mismo
 * tipo que el medio y del circuito del pago) y los del mismo tipo que son del
 * otro circuito, que la pantalla muestra apagados para que se vea por qué
 * falta uno.
 *
 * El tipo: un e-Cheq recibido no se puede entregar como cheque de papel ni al
 * revés, son dos instrumentos distintos. El circuito: el del B endosado en un
 * pago blanco sale de Valores a depositar del estudio, donde nunca entró
 * (comité final, M8). La regla vive en Go (compras.registrarParte), que lo
 * rechaza igual; acá solo se refleja para no ofrecer lo que después falla.
 * Un pago sin circuito es blanco, como en Go.
 */
export function chequesParaEndosar(
  cartera: ChequeDeCartera[],
  medio: string,
  circuito: Circuito | "",
): { endosables: ChequeDeCartera[]; delOtroCircuito: ChequeDeCartera[]; esperanCae: ChequeDeCartera[] } {
  if (medio !== "cheque" && medio !== "echeq") return { endosables: [], delOtroCircuito: [], esperanCae: [] };
  const buscado = medio === "echeq" ? "echeq" : "fisico";
  const pago = circuito || "blanco";
  const delTipo = cartera.filter((c) => c.tipo === buscado);
  // Los trabados por la regla van aparte, bajo «Espera CAE»: así se ve por
  // qué no se eligen, igual que los del otro circuito (mes 23, M2S2-040).
  const libres = delTipo.filter((c) => !c.trabado);
  return {
    endosables: libres.filter((c) => c.circuito === pago),
    delOtroCircuito: libres.filter((c) => c.circuito !== pago),
    esperanCae: delTipo.filter((c) => c.trabado),
  };
}

/**
 * Al cambiar el circuito del pago, los renglones que endosaban un cheque del
 * otro circuito vuelven a «cheque nuevo»: si no, el pago se rechaza recién al
 * guardar. El importe se limpia solo si era el que heredó del cheque (el
 * endoso copia el importe del cheque); uno tipeado a mano se respeta.
 */
export function sinEndososDelOtroCircuito<R extends RenglonConCheque>(
  partes: R[],
  cartera: ChequeDeCartera[],
  circuito: Circuito | "",
): R[] {
  const pago = circuito || "blanco";
  return partes.map((p) => {
    if (!p.chequeId) return p;
    const cheque = cartera.find((c) => c.id === p.chequeId);
    if (!cheque || (cheque.circuito === pago && !cheque.trabado)) return p;
    return { ...p, chequeId: "", importe: p.importe === String(cheque.importe) ? "" : p.importe };
  });
}
