import { resumenDeCuentaPdf } from "@/lib/pdf/resumen-cuenta";
import type { ResumenDeCuenta } from "@/lib/dal/admin/resumen-cuenta";
import type { CasoPdf } from "../pdf";
import { EMISOR, EMISOR_LARGO, azarCon } from "./_azar";

const { entero, azar, elegir } = azarCon(1205);

type Emisor = Parameters<typeof resumenDeCuentaPdf>[1];

// El reloj de pdf.ts está quieto, así que `hoy` por omisión es AHORA (Go lo
// recibe como ahora).
function caso(nombre: string, resumen: ResumenDeCuenta, emisor: Emisor): CasoPdf {
  return { nombre, datos: { resumen, emisor }, generar: () => resumenDeCuentaPdf(resumen, emisor) };
}

// Sin emoji ni nada fuera de WinAnsi en las celdas: recortar() del TS mide
// el texto sin limpiar y pdf-lib tira un error (ver resumen_cuenta.go).
const DETALLES = [
  "Factura A 0003-00004567", "Pago en efectivo", "Nota de crédito por devolución de 3 placas de fenólico “premium” — mal cortadas",
  "Ajuste por redondeo", "Cheque rechazado Banco Galicia N° 123456 — librado por Pérez Hnos. S.R.L. y endosado a terceros",
  "Señá obra Güemes", "", "",
];

function movimientos(n: number): ResumenDeCuenta["movimientos"] {
  let saldo = 0;
  return Array.from({ length: n }, (_, i) => {
    const monto = azar() < 0.1 ? -entero(1e8) : Math.round((azar() - 0.4) * 1e8) / 100;
    saldo = Math.round((saldo + monto) * 100) / 100;
    return {
      id: `m${i}`,
      fecha: new Date(Date.UTC(2025, entero(12), 1 + entero(28), entero(24), entero(60))),
      tipo: elegir(["compra", "pago", "nota_credito", "nota_debito", "ajuste", "otro_tipo"]),
      detalle: azar() < 0.3 ? null : elegir(DETALLES),
      referencia: azar() < 0.3 ? null : azar() < 0.1 ? "" : elegir(["FA-A-0003-00004567", "REC-X-0001-00000321-COPIA-LARGA", "NC 12"]),
      monto,
      saldo,
    };
  });
}

const tramos = (a: number, b: number, c: number, d: number) => [
  { etiqueta: "Al día", monto: a },
  { etiqueta: "31 a 60 días", monto: b },
  { etiqueta: "61 a 90 días", monto: c },
  { etiqueta: "Más de 90 días", monto: d },
];

const cliente = {
  id: "c1",
  nombre: "Juan Pérez",
  razonSocial: "Constructora Ñandú S.A.",
  cuit: "30-71234567-8",
  direccion: "Av. Rivadavia 12.345, Flores",
  limiteCredito: 500000,
};

export const casos: CasoPdf[] = [
  caso("vacio", {
    cliente: { ...cliente, razonSocial: null, cuit: null, direccion: null },
    movimientos: [],
    saldo: 0,
    aging: { tramos: tramos(0, 0, 0, 0), total: 0, aFavor: 0, diasDeLaMasVieja: null },
  } as unknown as ResumenDeCuenta, null),
  caso("deudor", {
    cliente,
    movimientos: movimientos(15),
    saldo: 812345.67,
    aging: { tramos: tramos(312345.67, 200000, 0, 300000.005), total: 812345.67, aFavor: 0, diasDeLaMasVieja: 1 },
  } as unknown as ResumenDeCuenta, EMISOR),
  caso("a-favor", {
    cliente: { ...cliente, razonSocial: "" },
    movimientos: movimientos(4),
    saldo: -12345.5,
    aging: { tramos: tramos(0, 0, 0, 0), total: 0, aFavor: 12345.5, diasDeLaMasVieja: null },
  } as unknown as ResumenDeCuenta, EMISOR_LARGO),
  caso("muy-largo", {
    cliente,
    movimientos: movimientos(220),
    saldo: 99999999999.99,
    aging: { tramos: tramos(1e9, 2e9, 3e9, 9.5e10), total: 1e11, aFavor: 0, diasDeLaMasVieja: 1234 },
  } as unknown as ResumenDeCuenta, EMISOR),
  caso("cero-negativo", {
    cliente,
    movimientos: movimientos(2),
    saldo: -0,
    aging: { tramos: tramos(5, 0, 0, 0), total: 5, aFavor: 0, diasDeLaMasVieja: 0 },
  } as unknown as ResumenDeCuenta, EMISOR),
];
