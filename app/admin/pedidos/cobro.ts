import type { MedioDeCobro } from "@/lib/cobros/partes";

/**
 * El medio con que el pedido dijo que paga, como renglón del cobro: el
 * diálogo arranca ahí (un pedido por transferencia abría en Efectivo, mes
 * simulado). La cuenta corriente y Mercado Pago no son un renglón del
 * cobro a mano: esos arrancan en efectivo, como siempre.
 */
const MEDIO_DEL_COBRO: Partial<Record<string, MedioDeCobro>> = {
  efectivo: "efectivo",
  transferencia: "transferencia",
  debito: "tarjeta_debito",
  credito: "tarjeta_credito",
  cheque: "cheque",
};

/**
 * Lo que necesita «Cobrar» de un pedido: el saldo (lo sin cobrar de Go, o el
 * total si es a cuenta corriente: el tope lo pone el servidor), a nombre de
 * quién sale el recibo y con qué medio arranca.
 */
export function cobroDelPedido(p: {
  numero: string;
  total: string | number;
  sinCobrar?: number | null;
  customerId?: string | null;
  cliente?: string | null;
  contactoNombre?: string | null;
  medioPago?: string | null;
  /** El pedido partido (H047): sin resto por cobrar, no hay nada que cobrar desde acá. */
  aCuenta?: number | null;
}) {
  return {
    numero: p.numero,
    aCobrar: p.sinCobrar ?? (p.aCuenta != null ? 0 : Number(p.total)),
    customerId: p.customerId ?? null,
    nombre: p.cliente ?? p.contactoNombre ?? "",
    medio: (p.medioPago && MEDIO_DEL_COBRO[p.medioPago]) || ("efectivo" as MedioDeCobro),
  };
}
