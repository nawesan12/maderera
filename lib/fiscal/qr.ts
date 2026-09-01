import "server-only";

import QRCode from "qrcode";
import { CODIGO_COMPROBANTE, documentoReceptor, type TipoComprobante } from "./comprobantes";

/**
 * QR de la factura electrónica.
 *
 * Desde 2021 todo comprobante autorizado tiene que llevarlo. Es un enlace a
 * ARCA con los datos del comprobante codificados en base64: quien lo escanea
 * verifica contra ARCA que la factura que tiene en la mano existe y es esa.
 *
 * Solo tiene sentido en un comprobante con CAE. Sin autorización, el QR
 * llevaría a una verificación que falla, así que directamente no se dibuja.
 */
export interface DatosQr {
  fecha: Date;
  cuitEmisor: string;
  puntoVenta: number;
  tipo: TipoComprobante;
  numero: number;
  total: number;
  receptorCuit: string | null;
  cae: string;
}

export function urlQr(datos: DatosQr): string {
  const doc = documentoReceptor(datos.receptorCuit);

  const contenido = {
    ver: 1,
    fecha: datos.fecha.toISOString().slice(0, 10),
    cuit: Number(datos.cuitEmisor.replace(/\D/g, "")),
    ptoVta: datos.puntoVenta,
    tipoCmp: CODIGO_COMPROBANTE[datos.tipo],
    nroCmp: datos.numero,
    importe: Number(datos.total.toFixed(2)),
    moneda: "PES",
    ctz: 1,
    tipoDocRec: doc.tipo,
    nroDocRec: doc.numero,
    tipoCodAut: "E",
    codAut: Number(datos.cae),
  };

  const base64 = Buffer.from(JSON.stringify(contenido), "utf8").toString(
    "base64",
  );

  return `https://www.afip.gob.ar/fe/qr/?p=${base64}`;
}

/**
 * El QR como SVG, listo para incrustar en la impresión.
 *
 * Va como SVG y no como imagen para que no dependa de una petición más al
 * imprimir: una factura que sale de la impresora con el QR vacío no sirve.
 */
export async function qrSvg(datos: DatosQr): Promise<string> {
  return QRCode.toString(urlQr(datos), {
    type: "svg",
    margin: 0,
    errorCorrectionLevel: "M",
  });
}

/**
 * El QR como PNG, para el PDF descargable.
 *
 * `pdf-lib` no dibuja SVG: incrusta imágenes. Se genera en escala de grises al
 * doble del tamaño impreso para que no se vea escalonado en papel, y sin margen
 * porque el espacio lo pone la hoja.
 */
export async function qrPng(datos: DatosQr): Promise<Uint8Array> {
  const buffer = await QRCode.toBuffer(urlQr(datos), {
    type: "png",
    margin: 0,
    width: 320,
    errorCorrectionLevel: "M",
  });

  return new Uint8Array(buffer);
}
