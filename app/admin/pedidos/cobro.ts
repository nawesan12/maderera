/**
 * Lo que necesita «Cobrar» de un pedido: el saldo (lo sin cobrar de Go, o el
 * total si es a cuenta corriente: el tope lo pone el servidor) y a nombre de
 * quién sale el recibo.
 */
export function cobroDelPedido(p: {
  numero: string;
  total: string | number;
  sinCobrar?: number | null;
  customerId?: string | null;
  cliente?: string | null;
  contactoNombre?: string | null;
}) {
  return {
    numero: p.numero,
    aCobrar: p.sinCobrar ?? Number(p.total),
    customerId: p.customerId ?? null,
    nombre: p.cliente ?? p.contactoNombre ?? "",
  };
}
