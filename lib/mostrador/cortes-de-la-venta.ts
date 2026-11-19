import type { LineaDeVenta } from "./importes";
import type { CorteDeMostrador } from "./tipos";

/**
 * Los cortes de la venta del mostrador y sus renglones (comité final, A2).
 *
 * Antes la venta tenía un solo corte y sus renglones se reconocían por la
 * descripción. Reabrir el corte para corregirlo arrancaba vacío, y los
 * renglones nuevos se sumaban a los viejos: se cobraban dos placas, dos
 * cortes y dos tapacantos, mientras al taller llegaba un solo despiece. Con
 * dos placas distintas pasaba lo mismo.
 *
 * Ahora una venta lleva los cortes que haga falta, y cada renglón que sale de
 * un corte lleva su `corteId`. Reabrir un corte lo edita: sus renglones se
 * reemplazan, no se suman. Sacar uno de sus renglones saca el corte entero,
 * porque Go rechaza lo cobrado de un corte que no cierra con su plano (ni de
 * menos ni de más).
 *
 * `E` es lo cargado en el diálogo, para volver a abrirlo tal cual.
 */
export interface CorteEnLaVenta<E, P extends { variantId: string } = { variantId: string }> {
  id: string;
  /** La placa sobre la que se corta (el resultado del buscador). */
  placa: P;
  corte: CorteDeMostrador;
  estado: E;
}

/** Agrega un corte nuevo, o reemplaza los renglones y el despiece de uno que ya está. */
export function conElCorte<E, P extends { variantId: string }>(
  lineas: LineaDeVenta[],
  cortes: CorteEnLaVenta<E, P>[],
  nuevo: CorteEnLaVenta<E, P>,
  renglones: LineaDeVenta[],
): { lineas: LineaDeVenta[]; cortes: CorteEnLaVenta<E, P>[] } {
  const atados = renglones.map((l) => ({ ...l, corteId: nuevo.id }));
  const i = lineas.findIndex((l) => l.corteId === nuevo.id);
  const sinLosViejos = lineas.filter((l) => l.corteId !== nuevo.id);
  // Los renglones corregidos quedan donde estaban los viejos: la venta no se
  // reordena porque se haya corregido un corte.
  const donde = i === -1 ? sinLosViejos.length : lineas.slice(0, i).filter((l) => l.corteId !== nuevo.id).length;
  const ya = cortes.some((c) => c.id === nuevo.id);
  return {
    lineas: [...sinLosViejos.slice(0, donde), ...atados, ...sinLosViejos.slice(donde)],
    cortes: ya ? cortes.map((c) => (c.id === nuevo.id ? nuevo : c)) : [...cortes, nuevo],
  };
}

/** Saca el corte y todos sus renglones. */
export function sinElCorte<C extends { id: string }>(
  lineas: LineaDeVenta[],
  cortes: C[],
  id: string,
): { lineas: LineaDeVenta[]; cortes: C[] } {
  return {
    lineas: lineas.filter((l) => l.corteId !== id),
    cortes: cortes.filter((c) => c.id !== id),
  };
}

/**
 * Lo que viaja a Go: los cortes que siguen en la venta, en orden, y cada
 * renglón con el índice de su corte (`corte`) en vez del id de la pantalla.
 * Un corte sin renglones no viaja: el taller cortaría algo que no se cobró.
 */
export function paraCobrar(
  lineas: LineaDeVenta[],
  cortes: { id: string; corte: CorteDeMostrador }[],
): { lineas: LineaDeVenta[]; cortes: CorteDeMostrador[] } {
  const vivos = cortes.filter((c) => lineas.some((l) => l.corteId === c.id));
  const indice = new Map(vivos.map((c, i) => [c.id, i]));
  return {
    lineas: lineas.map(({ corteId, ...l }) => {
      const i = corteId != null ? indice.get(corteId) : undefined;
      return i === undefined ? l : { ...l, corte: i };
    }),
    cortes: vivos.map((c) => c.corte),
  };
}
