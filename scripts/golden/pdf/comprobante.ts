import { comprobantePdf, type ComprobantePdf } from "@/lib/pdf/comprobante";
import type { TipoComprobante } from "@/lib/fiscal/comprobantes";
import { urlQr } from "@/lib/fiscal/qr";
import QRCode from "qrcode";
import { writeFileSync } from "node:fs";
import type { CasoPdf } from "../pdf";
import { EMISOR, EMISOR_LARGO, azarCon } from "./_azar";

const { entero, elegir, palabras, azar } = azarCon(1210);

type Emisor = Parameters<typeof comprobantePdf>[1];

function caso(nombre: string, comprobante: ComprobantePdf, emisor: Emisor): CasoPdf {
  return { nombre, datos: { comprobante, emisor }, generar: () => comprobantePdf(comprobante, emisor) };
}

const EMISOR_FISCAL = {
  ...EMISOR,
  ingresosBrutos: "901-123456-7",
  inicioActividades: new Date("1981-03-01T00:00:00.000Z"),
};

const importe = () => (azar() < 0.1 ? (azar() * 1e9).toFixed(2) : (azar() * 300000).toFixed(entero(3)));

function items(n: number): ComprobantePdf["items"] {
  return Array.from({ length: n }, () => ({
    descripcion: palabras(1 + entero(14)),
    unidad: elegir(["unidad", "metro_lineal", "metro_cuadrado", "kg", "placa", "otra_cosa", ""]),
    cantidad: elegir(["1", "2.500", "10.000", "0.333", "1500"]),
    precioUnitario: importe(),
    alicuotaIva: elegir(["21.00", "10.50", "27.00", "0.00"]),
    subtotal: importe(),
  }));
}

function base(tipo: TipoComprobante, extra: Partial<ComprobantePdf> = {}): ComprobantePdf {
  return {
    tipo,
    puntoVenta: 3,
    numero: 127,
    receptorNombre: "Constructora del Atlántico S.A.",
    receptorCuit: "30712345678",
    receptorCondicionIva: "responsable_inscripto",
    receptorDomicilio: "Av. Colón 1234, Mar del Plata",
    neto: "100000.00",
    iva21: "21000.00",
    iva105: "0.00",
    exento: "0.00",
    tributosTotal: "0.00",
    total: "121000.00",
    cae: null,
    caeVencimiento: null,
    fechaEmision: new Date("2026-03-05T00:00:00.000Z"),
    fechaVencimiento: null,
    observaciones: null,
    estado: "emitida",
    items: items(3),
    tributos: [],
    ...extra,
  };
}

const CAE = { cae: "76123456789012", caeVencimiento: new Date("2026-03-15T00:00:00.000Z") };

export const casos: CasoPdf[] = [
  caso("a-sin-cae", base("factura_a"), EMISOR_FISCAL),
  caso("a-con-cae", base("factura_a", {
    ...CAE,
    iva105: "1050.00",
    iva27: "2700.00",
    exento: "500.00",
    fechaVencimiento: new Date("2026-04-05T00:00:00.000Z"),
    tributos: [{ descripcion: "Percepción IIBB Bs. As.", alicuota: "3.00", importe: "3630.00" }, { descripcion: "Impuesto “municipal” — tasa", alicuota: "0.50", importe: "605" }],
    observaciones: "Entrega en obra. " + palabras(40),
  }), EMISOR_FISCAL),
  caso("b-con-cae", base("factura_b", { ...CAE, receptorCuit: null, receptorCondicionIva: "consumidor_final", receptorDomicilio: null, receptorNombre: "Consumidor final", total: "9999999999.99", items: items(8) }), EMISOR_FISCAL),
  caso("b-dni", base("factura_b", { ...CAE, receptorCuit: "12.345.678", receptorCondicionIva: "monotributista", numero: 99999999, puntoVenta: 12 }), EMISOR_FISCAL),
  caso("c-sin-emisor", base("factura_c", { ...CAE, receptorCondicionIva: "otra_condicion" }), null),
  caso("c-sin-cuit-emisor", base("factura_c", { ...CAE }), { ...EMISOR_FISCAL, cuit: null }),
  caso("nc-a-anulada", base("nota_credito_a", { ...CAE, estado: "anulada" }), EMISOR_FISCAL),
  caso("nc-b-anulada-sin-cae", base("nota_credito_b", { estado: "anulada" }), EMISOR_LARGO),
  caso("nd-c", base("nota_debito_c", { ...CAE, cae: "123", receptorCuit: "20-99999999-1" }), EMISOR_FISCAL),
  caso("a-muchos-renglones", base("factura_a", { ...CAE, items: items(60), total: "123456789.49", neto: "-5", iva21: "abc" }), EMISOR_FISCAL),
  caso("a-sin-items", base("factura_a", { items: [], total: "0", neto: "0", iva21: "0" }), EMISOR_FISCAL),
  ...Array.from({ length: 6 }, (_, i) =>
    caso(`azar-${i}`, base(elegir(["factura_a", "factura_b", "factura_c", "nota_credito_a", "nota_debito_b"] as const), {
      cae: azar() < 0.7 ? String(10 ** 13 + entero(9e12)) : null,
      caeVencimiento: azar() < 0.5 ? new Date(Date.UTC(2026, entero(12), 1 + entero(28))) : null,
      fechaEmision: new Date(Date.UTC(2020 + entero(8), entero(12), 1 + entero(28))),
      puntoVenta: 1 + entero(9999),
      numero: entero(99999999),
      receptorCuit: azar() < 0.3 ? null : String(20000000000 + entero(1e10)),
      total: importe(),
      items: items(entero(12)),
    }), EMISOR_FISCAL)),
];

// Golden del QR: urlQr y la matriz de qrcode.create() (nivel M), con datos al
// azar y algunos textos que fuerzan segmentos numéricos y alfanuméricos.
const azarQr = azarCon(1212);
const TIPOS = ["factura_a", "factura_b", "factura_c", "nota_credito_a", "nota_credito_b", "nota_credito_c", "nota_debito_a", "nota_debito_b", "nota_debito_c"] as const;
const casosQr: unknown[] = [];
for (let i = 0; i < 150; i++) {
  const datos = {
    fecha: new Date(Date.UTC(2020 + azarQr.entero(8), azarQr.entero(12), 1 + azarQr.entero(28), azarQr.entero(24))),
    cuitEmisor: azarQr.elegir(["30-71234567-8", "20123456789", "", "abc"]),
    puntoVenta: 1 + azarQr.entero(9999),
    tipo: azarQr.elegir(TIPOS),
    numero: azarQr.entero(1e8),
    total: azarQr.azar() < 0.2 ? azarQr.azar() * 1e10 : Number((azarQr.azar() * 1e6).toFixed(azarQr.entero(4))),
    receptorCuit: azarQr.elegir([null, "", "12345678", "1234567", "20-12345678-9", "123"]),
    cae: azarQr.elegir(["76123456789012", String(10 ** 13 + azarQr.entero(9e12)), "x", ""]),
  };
  const url = urlQr(datos as never);
  casosQr.push({ datos, url, matriz: matriz(url) });
}
for (const texto of ["HTTPS://WWW.AFIP.GOB.AR/FE/QR/?P=123456789012345678901234567890", "0123456789", "ABC 123 $%*+-./:", "a", "ñandú — “x”", "12345678901234567890abcdefABCDEF0000000000000000000xyz", "A".repeat(300), "9".repeat(700) + "z".repeat(200)]) {
  casosQr.push({ texto, matriz: matriz(texto) });
}
function matriz(texto: string) {
  const q = QRCode.create(texto, { errorCorrectionLevel: "M" });
  // Los módulos empaquetados de a 8 (el primero en el bit alto), en base64.
  const d = q.modules.data;
  const bytes = new Uint8Array(Math.ceil(d.length / 8));
  for (let i = 0; i < d.length; i++) if (d[i]) bytes[i >> 3] |= 0x80 >> (i & 7);
  return { version: q.version, mascara: q.maskPattern, lado: q.modules.size, modulos: Buffer.from(bytes).toString("base64") };
}
// El benchmark (bench/tanda12) importa los casos sin reescribir los golden.
if (!process.env.PDF_GOLDEN_SOLO_LEER) writeFileSync(new URL("../../../backend/testdata/golden/pdf/qr.json", import.meta.url), JSON.stringify(casosQr) + "\n");
