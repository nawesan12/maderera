/**
 * De quién es el borrador del corte a medida.
 *
 * Cerrar el diálogo no pierde lo cargado (T4, hallazgo 20): volver a abrir la
 * misma placa arranca donde quedó. Pero «el mismo cliente» no alcanzaba para
 * decir que es la misma venta: dos clientes sin ficha son los dos `null`, y el
 * que pidió precio de veinte piezas en melamina blanca y no lo llevó le
 * dejaba su despiece al siguiente de la cola (comité de T4).
 *
 * El borrador se ata a la venta en curso, por su clave, que cambia al cobrar
 * o vaciar. Y si la venta estaba vacía al cerrarlo —el caso del que pregunta
 * y se va, que no deja nada que cobrar ni vaciar— vence a los dos minutos:
 * reabrir por un Esc de más es cosa de segundos, y en cinco la cola ya
 * cambió de cliente.
 */

export const VIDA_DEL_BORRADOR_SIN_VENTA_MS = 2 * 60_000;

export interface DuenoDelBorrador {
  clave: string;
  variantId: string;
  clienteId: string | null;
  /** Hasta cuándo vale (ms); nulo mientras la venta tenga algo. */
  vence: number | null;
}

export function duenoDelBorrador(d: {
  clave: string;
  variantId: string;
  clienteId: string | null;
  ventaVacia: boolean;
  ahora: number;
}): DuenoDelBorrador {
  return {
    clave: d.clave,
    variantId: d.variantId,
    clienteId: d.clienteId,
    vence: d.ventaVacia ? d.ahora + VIDA_DEL_BORRADOR_SIN_VENTA_MS : null,
  };
}

export function borradorVale(
  b: DuenoDelBorrador,
  actual: { clave: string; variantId: string; clienteId: string | null; ahora: number },
): boolean {
  return (
    b.clave === actual.clave &&
    b.variantId === actual.variantId &&
    b.clienteId === actual.clienteId &&
    (b.vence == null || actual.ahora < b.vence)
  );
}
