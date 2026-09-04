import { redondear } from "./impuestos";
import type { TipoComprobante } from "./comprobantes";

/**
 * Notas de crédito y de débito: la parte que se puede probar.
 *
 * Sin base de datos y sin `server-only`, a propósito. Hasta acá la anulación
 * era siempre por el total, copiaba el 100 % de los renglones y marcaba el
 * original como anulado **incondicionalmente** —y nada de eso tenía una sola
 * prueba, en la única parte del sistema que emite documentos con valor fiscal—.
 */

export interface ItemOriginal {
  id: string;
  descripcion: string;
  unidad: string;
  cantidad: number;
  /** Final, con IVA adentro: es como se guardan las líneas del comprobante. */
  subtotal: number;
  alicuotaIva: number;
}

export interface CantidadAAcreditar {
  itemId: string;
  cantidad: number;
}

export interface LineaDeNota {
  descripcion: string;
  unidad: string;
  cantidad: number;
  precioFinalUnitario: number;
  alicuota: number;
  /** Qué renglón del original corrige. */
  itemOrigenId: string;
}

/**
 * Los renglones de la nota.
 *
 * **El precio unitario sale del original**: `subtotal / cantidad` de la
 * factura, no de la cantidad parcial. Dividir por la cantidad parcial daría un
 * unitario inflado —devolver 2 de 10 placas a $121.000 la unidad en vez de
 * $12.100— y ese es exactamente el error que esta función existe para evitar.
 *
 * `parciales` en `null` significa por el total: todos los renglones enteros.
 */
export function lineasDeLaNota(
  items: ItemOriginal[],
  parciales: CantidadAAcreditar[] | null,
): LineaDeNota[] {
  const unitario = (item: ItemOriginal) =>
    item.cantidad > 0 ? redondear(item.subtotal / item.cantidad) : 0;

  if (!parciales) {
    return items.map((item) => ({
      descripcion: item.descripcion,
      unidad: item.unidad,
      cantidad: item.cantidad,
      precioFinalUnitario: unitario(item),
      alicuota: item.alicuotaIva,
      itemOrigenId: item.id,
    }));
  }

  const lineas: LineaDeNota[] = [];

  for (const pedido of parciales) {
    const item = items.find((i) => i.id === pedido.itemId);
    if (!item) continue;
    if (!Number.isFinite(pedido.cantidad) || pedido.cantidad <= 0) continue;

    /*
     * Acreditar más de lo facturado no es un caso raro que convenga tolerar:
     * es un error de carga que dejaría el libro IVA con más crédito del que el
     * comprobante respalda.
     */
    if (pedido.cantidad > item.cantidad) {
      throw new Error(
        `No se puede acreditar más de lo facturado en "${item.descripcion}".`,
      );
    }

    lineas.push({
      descripcion: item.descripcion,
      unidad: item.unidad,
      cantidad: pedido.cantidad,
      precioFinalUnitario: unitario(item),
      alicuota: item.alicuotaIva,
      itemOrigenId: item.id,
    });
  }

  return lineas;
}

export interface TributoDelComprobante {
  codigo: string;
  descripcion: string;
  base: number;
  alicuota: number;
  importe: number;
}

/**
 * Copia los tributos del original, prorrateados.
 *
 * **Se copian en vez de recalcularse con la configuración de hoy.** Una nota
 * emitida después de que cambiara la alícuota de percepción de Ingresos Brutos
 * se calculaba con la nueva y no cerraba contra su factura, que llevaba la
 * vieja. La alícuota no se prorratea: sigue siendo la que tuvo la factura.
 */
export function prorratearTributos(
  tributos: TributoDelComprobante[],
  proporcion: number,
): TributoDelComprobante[] {
  if (proporcion >= 1) return tributos;

  return tributos.map((t) => ({
    ...t,
    base: redondear(t.base * proporcion),
    importe: redondear(t.importe * proporcion),
  }));
}

/** Medio centavo de tolerancia: acreditar el resto exacto no puede fallar. */
const TOLERANCIA = 0.005;

/**
 * Si se puede acreditar ese monto contra ese comprobante.
 *
 * Devuelve el motivo cuando no se puede, o `null` cuando sí. El tope existe
 * porque sin él dos notas parciales por descuido acreditan más de lo facturado,
 * y el libro IVA queda con crédito que ningún comprobante respalda.
 */
export function revisarAcreditacion(
  totalOriginal: number,
  acreditado: number,
  monto: number,
): string | null {
  if (!Number.isFinite(monto) || monto <= 0) {
    return "El monto a acreditar tiene que ser mayor a cero.";
  }

  const disponible = totalOriginal - acreditado;

  if (monto > disponible + TOLERANCIA) {
    return `Ya se acreditaron $${acreditado.toFixed(2)} de $${totalOriginal.toFixed(2)}: quedan $${Math.max(0, disponible).toFixed(2)}.`;
  }

  return null;
}

/**
 * Si el comprobante corrige a otro y por lo tanto tiene que declararlo.
 *
 * **Es el arreglo de un bug concreto:** el XML de ARCA mandaba `CbtesAsoc`
 * solo cuando era nota de crédito, así que una nota de débito salía sin él y
 * ARCA lo exige igual. El predicado tiene que ser más amplio que
 * `esNotaDeCredito`, y si algún día vuelven a coincidir, el bug vuelve.
 */
export function esRectificativo(tipo: TipoComprobante): boolean {
  return tipo.startsWith("nota_credito") || tipo.startsWith("nota_debito");
}
