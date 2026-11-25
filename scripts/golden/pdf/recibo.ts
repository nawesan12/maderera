import { reciboPdf } from "@/lib/pdf/recibo";
import type { ReciboCompleto, ParteDelRecibo } from "@/lib/dal/recibos";
import type { CasoPdf } from "../pdf";
import { EMISOR, EMISOR_LARGO, azarCon } from "./_azar";

const { entero, palabras, azar, elegir } = azarCon(1204);

type Emisor = Parameters<typeof reciboPdf>[1];

function caso(nombre: string, recibo: ReciboCompleto, emisor: Emisor): CasoPdf {
  return { nombre, datos: { recibo, emisor }, generar: () => reciboPdf(recibo, emisor) };
}

const MEDIOS = ["efectivo", "transferencia", "deposito", "cheque", "echeq", "tarjeta_debito", "tarjeta_credito", "mercado_pago", "retencion", "trueque"] as const;

function parte(): ParteDelRecibo {
  const medio = elegir(MEDIOS) as ParteDelRecibo["medio"];
  const esCheque = medio === "cheque" || medio === "echeq";
  return {
    medio,
    importe: azar() < 0.1 ? entero(1e9) + 0.5 : Math.round(azar() * 5e7) / 100,
    referencia: azar() < 0.5 ? null : azar() < 0.2 ? "" : `OP-${entero(1e8)}`,
    cheque: esCheque
      ? {
          id: "ch",
          tipo: medio === "echeq" ? "echeq" : "fisico",
          numero: String(entero(1e8)),
          banco: azar() < 0.2 ? null : azar() < 0.1 ? "" : elegir(["Banco Galicia", "Banco de la Nación Argentina", "BBVA Francés — Sucursal Flores"]),
          librador: azar() < 0.4 ? null : palabras(1 + entero(5)),
          fechaPago: new Date(Date.UTC(2026, entero(12), 1 + entero(28))),
          estado: "en_cartera",
        }
      : null,
  };
}

const base: ReciboCompleto = {
  id: "rc1",
  numero: "X-0001-00000321",
  fecha: new Date("2026-03-05T14:00:00.000Z"),
  estado: "emitido",
  origen: "mostrador",
  concepto: "Pago a cuenta de la factura A 0003-00004567",
  total: 1234567.89,
  recibidoDe: "Constructora Ñandú S.A.",
  motivoAnulacion: null,
  anuladoAt: null,
  cliente: { id: "c1", cuit: "30-71234567-8", direccion: "Av. Rivadavia 12.345" },
  partes: [
    { medio: "efectivo", importe: 234567.89, referencia: null, cheque: null },
    {
      medio: "cheque",
      importe: 1000000,
      referencia: null,
      cheque: { id: "ch1", tipo: "fisico", numero: "00123456", banco: "Banco Galicia", librador: "Pérez Hnos.", fechaPago: new Date("2026-04-01T00:00:00.000Z"), estado: "en_cartera" },
    },
  ],
  saldoDespues: 15000.5,
  emitidoPor: "María Gómez",
};

export const casos: CasoPdf[] = [
  caso("minimo", { ...base, concepto: null, cliente: null, partes: [], total: 0, saldoDespues: null, emitidoPor: null }, null),
  caso("normal", base, EMISOR),
  caso("saldada", { ...base, saldoDespues: 0.004, total: 1, partes: [{ medio: "transferencia", importe: 1, referencia: "TRF-998877", cheque: null }] }, EMISOR),
  caso("a-favor", { ...base, saldoDespues: -98765.43, total: 21.21, concepto: "“Seña” — obra calle Güemes… " + palabras(80) }, EMISOR_LARGO),
  caso("anulado", { ...base, estado: "anulado", motivoAnulacion: "Se cargó dos veces — el cliente pagó una sola", partes: Array.from({ length: 25 }, parte) }, EMISOR),
  caso("montos", { ...base, total: 1001001001.01, saldoDespues: 21000000, partes: [{ medio: "retencion", importe: -500.555, referencia: null, cheque: null }] }, EMISOR),
  caso("veintiun-mil", { ...base, total: 21021.995, saldoDespues: 1e12 }, EMISOR),
  caso("muchas-partes", { ...base, partes: Array.from({ length: 60 }, parte), estado: "anulado", motivoAnulacion: null }, EMISOR),
];
