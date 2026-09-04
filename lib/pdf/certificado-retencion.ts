import "server-only";

import {
  A4,
  LINEA,
  MARGEN,
  TINTA_SUAVE,
  encabezadoEmisor,
  escribir,
  escribirCentrado,
  linea,
  mm,
  nuevaHoja,
  recuadro,
  serializar,
} from "./hoja";
import { formatearCuit, moneda } from "@/lib/formato";

/**
 * El certificado de retención que se le entrega al proveedor.
 *
 * **No es un papel de cortesía.** Es el comprobante con el que el proveedor se
 * computa esa retención en su propia declaración: sin él, le retuvimos plata
 * que él no puede recuperar. Por eso lleva número propio y correlativo, el
 * código del régimen, y la base sobre la que se calculó.
 *
 * Va en A4 y con un solo certificado por hoja: el proveedor los archiva por
 * separado y a menudo los presenta sueltos.
 */

export interface DatosDelCertificado {
  numero: string;
  fecha: Date;
  impuesto: string;
  codigoRegimen: string;
  nombreRegimen: string;
  base: number;
  alicuota: number;
  importe: number;

  emisor: {
    razonSocial?: string | null;
    nombreFantasia?: string | null;
    domicilio?: string | null;
    cuit?: string | null;
  } | null;

  proveedor: {
    nombre: string;
    razonSocial?: string | null;
    cuit?: string | null;
    domicilio?: string | null;
  };

  pago: {
    fecha: Date;
    medio: string;
    referencia?: string | null;
  };
}

const IMPUESTOS: Record<string, string> = {
  ganancias: "Impuesto a las Ganancias",
  iva: "Impuesto al Valor Agregado",
  suss: "Sistema Único de Seguridad Social",
  iibb: "Ingresos Brutos",
};

export async function certificadoDeRetencionPdf(
  datos: DatosDelCertificado,
): Promise<Uint8Array> {
  const hoja = await nuevaHoja();

  let y = A4.alto - MARGEN;

  y = encabezadoEmisor(hoja, datos.emisor, y);
  y -= mm(6);

  escribirCentrado(hoja, "CERTIFICADO DE RETENCIÓN", {
    centroX: A4.ancho / 2,
    y,
    tamano: 15,
    fuente: hoja.negrita,
  });
  y -= mm(7);

  escribirCentrado(hoja, IMPUESTOS[datos.impuesto] ?? datos.impuesto, {
    centroX: A4.ancho / 2,
    y,
    tamano: 10,
    color: TINTA_SUAVE,
  });
  y -= mm(10);

  linea(hoja, y);
  y -= mm(8);

  /* Número y fecha, arriba de todo: es lo primero que busca quien lo archiva. */
  const columna = A4.ancho / 2;

  escribir(hoja, "Certificado n.º", { x: MARGEN, y, tamano: 8, color: TINTA_SUAVE });
  escribir(hoja, datos.numero, {
    x: MARGEN,
    y: y - mm(5),
    tamano: 13,
    fuente: hoja.negrita,
  });

  escribir(hoja, "Fecha", { x: columna, y, tamano: 8, color: TINTA_SUAVE });
  escribir(hoja, datos.fecha.toLocaleDateString("es-AR"), {
    x: columna,
    y: y - mm(5),
    tamano: 13,
    fuente: hoja.negrita,
  });

  y -= mm(14);

  escribir(hoja, "Agente de retención", {
    x: MARGEN,
    y,
    tamano: 8,
    color: TINTA_SUAVE,
  });
  y -= mm(5);
  escribir(hoja, datos.emisor?.razonSocial ?? "Maderera Juan B. Justo", {
    x: MARGEN,
    y,
    tamano: 10,
  });
  if (datos.emisor?.cuit) {
    escribir(hoja, `CUIT ${formatearCuit(datos.emisor.cuit)}`, {
      x: A4.ancho - MARGEN,
      y,
      tamano: 10,
      derecha: true,
      color: TINTA_SUAVE,
    });
  }

  y -= mm(10);

  escribir(hoja, "Sujeto retenido", { x: MARGEN, y, tamano: 8, color: TINTA_SUAVE });
  y -= mm(5);
  escribir(hoja, datos.proveedor.razonSocial || datos.proveedor.nombre, {
    x: MARGEN,
    y,
    tamano: 10,
  });
  if (datos.proveedor.cuit) {
    escribir(hoja, `CUIT ${formatearCuit(datos.proveedor.cuit)}`, {
      x: A4.ancho - MARGEN,
      y,
      tamano: 10,
      derecha: true,
      color: TINTA_SUAVE,
    });
  }
  if (datos.proveedor.domicilio) {
    y -= mm(5);
    escribir(hoja, datos.proveedor.domicilio, {
      x: MARGEN,
      y,
      tamano: 8.5,
      color: TINTA_SUAVE,
    });
  }

  y -= mm(12);

  /*
   * El cuadro del cálculo.
   *
   * Base, alícuota e importe juntos y en ese orden: es lo que permite que el
   * contador del proveedor verifique la cuenta sin llamar por teléfono.
   */
  const altoCuadro = mm(34);
  recuadro(hoja, {
    x: MARGEN,
    y: y - altoCuadro,
    ancho: A4.ancho - MARGEN * 2,
    alto: altoCuadro,
    grosor: 0.7,
    color: LINEA,
  });

  let cuadro = y - mm(8);

  escribir(hoja, "Régimen", { x: MARGEN + mm(5), y: cuadro, tamano: 8, color: TINTA_SUAVE });
  escribir(hoja, `${datos.codigoRegimen} · ${datos.nombreRegimen}`, {
    x: A4.ancho - MARGEN - mm(5),
    y: cuadro,
    tamano: 9,
    derecha: true,
  });
  cuadro -= mm(8);

  escribir(hoja, "Base de cálculo", { x: MARGEN + mm(5), y: cuadro, tamano: 8, color: TINTA_SUAVE });
  escribir(hoja, moneda.format(datos.base), {
    x: A4.ancho - MARGEN - mm(5),
    y: cuadro,
    tamano: 9,
    derecha: true,
  });
  cuadro -= mm(8);

  escribir(hoja, "Alícuota aplicada", { x: MARGEN + mm(5), y: cuadro, tamano: 8, color: TINTA_SUAVE });
  escribir(hoja, `${datos.alicuota.toFixed(2).replace(".", ",")} %`, {
    x: A4.ancho - MARGEN - mm(5),
    y: cuadro,
    tamano: 9,
    derecha: true,
  });
  cuadro -= mm(9);

  escribir(hoja, "IMPORTE RETENIDO", {
    x: MARGEN + mm(5),
    y: cuadro,
    tamano: 9,
    fuente: hoja.negrita,
  });
  escribir(hoja, moneda.format(datos.importe), {
    x: A4.ancho - MARGEN - mm(5),
    y: cuadro,
    tamano: 13,
    fuente: hoja.negrita,
    derecha: true,
  });

  y -= altoCuadro + mm(10);

  escribir(
    hoja,
    `Retención practicada sobre el pago del ${datos.pago.fecha.toLocaleDateString("es-AR")} por ${datos.pago.medio}${
      datos.pago.referencia ? ` (${datos.pago.referencia})` : ""
    }.`,
    { x: MARGEN, y, tamano: 8.5, color: TINTA_SUAVE },
  );

  y -= mm(24);

  /* La firma va abajo y con espacio: este papel se firma a mano. */
  hoja.pagina.drawLine({
    start: { x: MARGEN, y },
    end: { x: MARGEN + mm(70), y },
    thickness: 0.5,
    color: LINEA,
  });
  escribir(hoja, "Firma y sello del agente de retención", {
    x: MARGEN,
    y: y - mm(5),
    tamano: 7.5,
    color: TINTA_SUAVE,
  });

  escribirCentrado(
    hoja,
    "Conserve este comprobante: le permite computar la retención en su declaración jurada.",
    {
      centroX: A4.ancho / 2,
      y: MARGEN + mm(6),
      tamano: 7.5,
      color: TINTA_SUAVE,
    },
  );

  return serializar(hoja);
}
