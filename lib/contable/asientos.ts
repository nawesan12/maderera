/**
 * Los asientos para el estudio contable.
 *
 * **Esto no es contabilidad registrada.** El libro diario, el mayor, el balance
 * y el plan de cuentas los lleva el estudio con su sistema; lo que falta es que
 * pueda importar lo que pasó acá sin volver a tipearlo. Eso es todo lo que hace
 * este módulo: traducir cada operación a renglones de debe y haber.
 *
 * **La invariante es una sola y no se negocia: debe igual a haber.** Un asiento
 * desbalanceado hace que el sistema del estudio rechace el archivo entero, y
 * eso se descubre el día del vencimiento.
 *
 * Sin base de datos y sin `server-only`: es traducción pura, y por eso se puede
 * probar.
 */

/**
 * El plan de cuentas mínimo.
 *
 * Los códigos son los de uso corriente en Argentina, pero **son una sugerencia
 * y no la verdad**: cada estudio tiene el suyo, y la exportación lleva el
 * nombre además del código justamente para que se puedan remapear sin adivinar.
 */
export const CUENTAS = {
  caja: "1.1.01",
  banco: "1.1.02",
  deudores: "1.1.03",
  ivaCredito: "1.1.05",
  retencionesSufridas: "1.1.06",
  mercaderias: "1.2.01",

  proveedores: "2.1.01",
  ivaDebito: "2.1.03",
  percepcionesIibb: "2.1.04",
  retencionesAPagar: "2.1.05",

  ventas: "4.1.01",
  gastos: "5.1.01",
} as const;

const NOMBRES: Record<string, string> = {
  [CUENTAS.caja]: "Caja",
  [CUENTAS.banco]: "Banco",
  [CUENTAS.deudores]: "Deudores por ventas",
  [CUENTAS.ivaCredito]: "IVA crédito fiscal",
  [CUENTAS.retencionesSufridas]: "Retenciones sufridas",
  [CUENTAS.mercaderias]: "Mercaderías",
  [CUENTAS.proveedores]: "Proveedores",
  [CUENTAS.ivaDebito]: "IVA débito fiscal",
  [CUENTAS.percepcionesIibb]: "Percepciones IIBB a depositar",
  [CUENTAS.retencionesAPagar]: "Retenciones a depositar",
  [CUENTAS.ventas]: "Ventas",
  [CUENTAS.gastos]: "Gastos",
};

export interface RenglonDeAsiento {
  cuenta: string;
  nombre: string;
  debe: number;
  haber: number;
}

export interface Asiento {
  fecha: Date;
  concepto: string;
  renglones: RenglonDeAsiento[];
}

function renglon(cuenta: string, debe: number, haber: number): RenglonDeAsiento {
  return {
    cuenta,
    nombre: NOMBRES[cuenta] ?? cuenta,
    debe: redondear(debe),
    haber: redondear(haber),
  };
}

function redondear(v: number): number {
  return Math.round(v * 100) / 100;
}

/** Medio centavo: el redondeo de los renglones no puede invalidar un asiento. */
const TOLERANCIA = 0.005;

export function balancea(asiento: Asiento): boolean {
  const debe = asiento.renglones.reduce((t, r) => t + r.debe, 0);
  const haber = asiento.renglones.reduce((t, r) => t + r.haber, 0);
  return Math.abs(debe - haber) <= TOLERANCIA;
}

/**
 * Invierte un asiento.
 *
 * Las notas de crédito **se invierten en vez de anotarse en negativo**: los
 * sistemas contables rechazan importes negativos, y un "haber de −100.000" no
 * significa nada para quien lo lee.
 */
function invertir(renglones: RenglonDeAsiento[]): RenglonDeAsiento[] {
  return renglones.map((r) => ({ ...r, debe: r.haber, haber: r.debe }));
}

/* -------------------------------------------------------------------------- */
/* Ventas                                                                      */
/* -------------------------------------------------------------------------- */

export interface VentaAAsentar {
  fecha: Date;
  comprobante: string;
  cliente: string;
  neto: number;
  iva: number;
  tributos: number;
  total: number;
  esNotaDeCredito: boolean;
}

export function asientoDeVenta(v: VentaAAsentar): Asiento {
  const renglones: RenglonDeAsiento[] = [
    renglon(CUENTAS.deudores, v.total, 0),
    renglon(CUENTAS.ventas, 0, v.neto),
  ];

  // El IVA de una B existe aunque no se imprima: sin este renglón el asiento no
  // cerraría contra el total cobrado.
  if (v.iva !== 0) renglones.push(renglon(CUENTAS.ivaDebito, 0, v.iva));
  if (v.tributos !== 0) {
    renglones.push(renglon(CUENTAS.percepcionesIibb, 0, v.tributos));
  }

  return {
    fecha: v.fecha,
    concepto: `${v.comprobante} · ${v.cliente}`,
    renglones: v.esNotaDeCredito ? invertir(renglones) : renglones,
  };
}

/* -------------------------------------------------------------------------- */
/* Compras                                                                     */
/* -------------------------------------------------------------------------- */

export interface CompraAAsentar {
  fecha: Date;
  comprobante: string;
  proveedor: string;
  neto: number;
  iva: number;
  percepciones: number;
  total: number;
  /** La B y la C no lo dan: el IVA es más costo. */
  daCreditoFiscal: boolean;
  esNotaDeCredito: boolean;
}

export function asientoDeCompra(c: CompraAAsentar): Asiento {
  const renglones: RenglonDeAsiento[] = [];

  /*
   * **El error más caro del libro de compras.** La B y la C no discriminan IVA:
   * mandarlo a crédito fiscal infla el crédito del mes contra un papel que no
   * lo respalda. Sin crédito, el IVA es parte del costo de la mercadería.
   */
  if (c.daCreditoFiscal) {
    renglones.push(renglon(CUENTAS.mercaderias, c.neto, 0));
    if (c.iva !== 0) renglones.push(renglon(CUENTAS.ivaCredito, c.iva, 0));
  } else {
    renglones.push(renglon(CUENTAS.mercaderias, c.neto + c.iva, 0));
  }

  // Las percepciones que nos hicieron son un crédito contra el impuesto, no un
  // costo: se recuperan en la declaración.
  if (c.percepciones !== 0) {
    renglones.push(renglon(CUENTAS.retencionesSufridas, c.percepciones, 0));
  }

  renglones.push(renglon(CUENTAS.proveedores, 0, c.total));

  return {
    fecha: c.fecha,
    concepto: `${c.comprobante} · ${c.proveedor}`,
    renglones: c.esNotaDeCredito ? invertir(renglones) : renglones,
  };
}

/* -------------------------------------------------------------------------- */
/* Pagos y gastos                                                              */
/* -------------------------------------------------------------------------- */

export interface PagoAAsentar {
  fecha: Date;
  proveedor: string;
  referencia: string | null;
  /** Lo que se le imputa a la deuda: transferencia más retenciones. */
  total: number;
  retenido: number;
  medio: string;
}

export function asientoDePagoAProveedor(p: PagoAAsentar): Asiento {
  const cuentaDeSalida =
    p.medio === "efectivo" ? CUENTAS.caja : CUENTAS.banco;

  const renglones: RenglonDeAsiento[] = [
    renglon(CUENTAS.proveedores, p.total, 0),
    renglon(cuentaDeSalida, 0, p.total - p.retenido),
  ];

  /*
   * **La retención no es un gasto: es un pasivo contra el fisco.** Anotarla
   * como gasto la sacaría del saldo a depositar del mes, que es exactamente el
   * número que después hay que transferirle a ARCA.
   */
  if (p.retenido > 0) {
    renglones.push(renglon(CUENTAS.retencionesAPagar, 0, p.retenido));
  }

  return {
    fecha: p.fecha,
    concepto: `Pago a ${p.proveedor}${p.referencia ? ` · ${p.referencia}` : ""}`,
    renglones,
  };
}

export interface GastoAAsentar {
  fecha: Date;
  descripcion: string;
  categoria: string;
  importe: number;
  medio: string;
}

export function asientoDeGasto(g: GastoAAsentar): Asiento {
  const cuentaDeSalida =
    g.medio === "efectivo" ? CUENTAS.caja : CUENTAS.banco;

  return {
    fecha: g.fecha,
    concepto: `${g.categoria} · ${g.descripcion}`,
    renglones: [
      renglon(CUENTAS.gastos, g.importe, 0),
      renglon(cuentaDeSalida, 0, g.importe),
    ],
  };
}
