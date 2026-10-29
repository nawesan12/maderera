import { certificadoDeRetencionPdf, type DatosDelCertificado } from "@/lib/pdf/certificado-retencion";
import type { CasoPdf } from "../pdf";
import { EMISOR, EMISOR_LARGO } from "./_azar";

function caso(nombre: string, datos: DatosDelCertificado): CasoPdf {
  return { nombre, datos, generar: () => certificadoDeRetencionPdf(datos) };
}

const base: DatosDelCertificado = {
  numero: "0001-00000042",
  fecha: new Date("2026-03-05T14:00:00.000Z"),
  impuesto: "ganancias",
  codigoRegimen: "078",
  nombreRegimen: "Enajenación de bienes muebles y bienes de cambio",
  base: 1234567.89,
  alicuota: 2,
  importe: 24691.36,
  emisor: EMISOR,
  proveedor: { nombre: "Aserradero del Litoral", razonSocial: "Aserradero del Litoral S.A.", cuit: "30712345678", domicilio: "Ruta 14 km 312, Gualeguaychú, Entre Ríos" },
  pago: { fecha: new Date("2026-03-04T23:30:00.000Z"), medio: "transferencia", referencia: "OP-998877" },
};

export const casos: CasoPdf[] = [
  caso("normal", base),
  caso("sin-emisor", { ...base, emisor: null, impuesto: "iva", alicuota: 10.5, proveedor: { nombre: "Juan Pérez" }, pago: { fecha: base.pago.fecha, medio: "cheque" } }),
  caso("razon-vacia", {
    ...base,
    emisor: { ...EMISOR, razonSocial: "", cuit: "20-1234-5" },
    impuesto: "impuesto_raro",
    alicuota: 1.005,
    base: 999999999999.5,
    importe: -0.5,
    proveedor: { nombre: "Proveedor “raro” — con emoji 😀", razonSocial: null, cuit: "", domicilio: null },
  }),
  caso("largo", {
    ...base,
    emisor: EMISOR_LARGO,
    impuesto: "iibb",
    codigoRegimen: "IIBB-CABA-RG-939/2013",
    nombreRegimen: "Agentes de recaudación — régimen general de retenciones sobre pagos a proveedores con alícuota según padrón de riesgo fiscal",
    alicuota: 0.125,
    importe: 1543.209875,
    pago: { fecha: base.pago.fecha, medio: "cheque diferido del Banco de la Nación Argentina", referencia: "Cheque N° 00123456 al 30/4/2026" },
  }),
  caso("suss", { ...base, impuesto: "suss", alicuota: 0, importe: 0, base: 0 }),
];
