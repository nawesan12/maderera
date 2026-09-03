import "server-only";

import {
  A4,
  MARGEN,
  LINEA,
  NARANJA,
  TINTA,
  TINTA_SUAVE,
  encabezadoEmisor,
  escribir,
  escribirCentrado,
  escribirParrafo,
  linea,
  marcaDeAgua,
  mm,
  nuevaHoja,
  recuadro,
  serializar,
} from "./hoja";
import { qrPng } from "@/lib/fiscal/qr";
import {
  discriminaIva,
  letraDe,
  nombreComprobante,
  numeroFormateado,
  type TipoComprobante,
} from "@/lib/fiscal/comprobantes";
import { fechaSolaCorta, formatearCuit, formatearUnidad, moneda } from "@/lib/formato";

/**
 * El comprobante fiscal en PDF.
 *
 * Es el mismo documento que la hoja imprimible de `/comprobante/[id]`, con el
 * mismo orden y las mismas reglas: la letra en recuadro al centro, el IVA
 * discriminado solo en la A, el QR únicamente cuando hay CAE, y la marca de
 * agua cuando no la hay.
 *
 * Que sean dos implementaciones del mismo papel no es ideal, pero la
 * alternativa —renderizar el HTML con un navegador headless— cuesta 300 MB de
 * dependencia y varios segundos por documento. Lo que sí está compartido es
 * todo lo que decide: `lib/fiscal/comprobantes.ts` dice la letra, si discrimina
 * IVA y cómo se numera.
 */

export interface ComprobantePdf {
  tipo: TipoComprobante;
  puntoVenta: number;
  numero: number;
  receptorNombre: string;
  receptorCuit: string | null;
  receptorCondicionIva: string;
  receptorDomicilio: string | null;
  neto: string;
  iva21: string;
  iva27?: string;
  iva105: string;
  exento: string;
  tributosTotal: string;
  total: string;
  cae: string | null;
  caeVencimiento: Date | null;
  fechaEmision: Date;
  fechaVencimiento: Date | null;
  observaciones: string | null;
  estado: string;
  items: {
    descripcion: string;
    unidad: string;
    cantidad: string;
    precioUnitario: string;
    alicuotaIva: string;
    subtotal: string;
  }[];
  tributos: { descripcion: string; alicuota: string; importe: string }[];
}

const CONDICIONES: Record<string, string> = {
  responsable_inscripto: "Responsable inscripto",
  monotributista: "Responsable monotributo",
  exento: "IVA exento",
  consumidor_final: "Consumidor final",
  no_categorizado: "No categorizado",
};

export async function comprobantePdf(
  comprobante: ComprobantePdf,
  emisor: {
    razonSocial?: string | null;
    nombreFantasia?: string | null;
    domicilio?: string | null;
    cuit?: string | null;
    ingresosBrutos?: string | null;
    inicioActividades?: Date | null;
  } | null,
): Promise<Uint8Array> {
  const hoja = await nuevaHoja();
  const derecha = A4.ancho - MARGEN;
  const discrimina = discriminaIva(comprobante.tipo);

  if (!comprobante.cae) marcaDeAgua(hoja, "Sin valor fiscal");
  if (comprobante.estado === "anulada") marcaDeAgua(hoja, "Anulada");

  // Emisor
  let y = A4.alto - MARGEN - 10;
  const finEmisor = encabezadoEmisor(hoja, emisor, y);

  if (emisor?.ingresosBrutos) {
    escribir(hoja, `Ingresos Brutos ${emisor.ingresosBrutos}`, {
      x: MARGEN,
      y: finEmisor,
      tamano: 7.5,
      color: TINTA_SUAVE,
    });
  }

  // Letra, en recuadro al centro. Es lo que mira primero cualquiera que
  // recibe una factura, y ARCA exige que esté.
  const anchoCaja = mm(18);
  const altoCaja = mm(16);
  const xCaja = (A4.ancho - anchoCaja) / 2;
  const yCaja = A4.alto - MARGEN - altoCaja - 4;

  recuadro(hoja, {
    x: xCaja,
    y: yCaja,
    ancho: anchoCaja,
    alto: altoCaja,
    grosor: 1.5,
  });

  escribirCentrado(hoja, letraDe(comprobante.tipo), {
    centroX: xCaja + anchoCaja / 2,
    y: yCaja + mm(5.5),
    tamano: 26,
    fuente: hoja.negrita,
  });

  escribirCentrado(hoja, "COMPROBANTE", {
    centroX: xCaja + anchoCaja / 2,
    y: yCaja + mm(2),
    tamano: 5,
    color: TINTA_SUAVE,
  });

  // Numeración y fechas
  y = A4.alto - MARGEN - 10;
  escribir(hoja, nombreComprobante(comprobante.tipo), {
    x: derecha,
    y,
    tamano: 11,
    fuente: hoja.negrita,
    derecha: true,
  });
  y -= 15;

  escribir(
    hoja,
    numeroFormateado(comprobante.puntoVenta, comprobante.numero),
    { x: derecha, y, tamano: 13, fuente: hoja.mono, derecha: true },
  );
  y -= 13;

  escribir(hoja, `Fecha ${fechaSolaCorta.format(comprobante.fechaEmision)}`, {
    x: derecha,
    y,
    tamano: 7.5,
    color: TINTA_SUAVE,
    derecha: true,
  });
  y -= 10;

  if (comprobante.fechaVencimiento) {
    escribir(
      hoja,
      `Vencimiento ${fechaSolaCorta.format(comprobante.fechaVencimiento)}`,
      { x: derecha, y, tamano: 7.5, color: TINTA_SUAVE, derecha: true },
    );
    y -= 10;
  }

  // Receptor
  let cursor = Math.min(finEmisor, yCaja) - mm(8);
  const altoReceptor = mm(20);

  recuadro(hoja, {
    x: MARGEN,
    y: cursor - altoReceptor,
    ancho: A4.ancho - MARGEN * 2,
    alto: altoReceptor,
    grosor: 0.5,
    color: LINEA,
  });

  escribir(hoja, "DESTINATARIO", {
    x: MARGEN + 8,
    y: cursor - 12,
    tamano: 6,
    fuente: hoja.negrita,
    color: TINTA_SUAVE,
  });

  const columna = (A4.ancho - MARGEN * 2) / 2;

  const datos: [string, string][] = [
    ["Razón social", comprobante.receptorNombre],
    ["CUIT / DNI", formatearCuit(comprobante.receptorCuit) || "—"],
    [
      "Condición frente al IVA",
      CONDICIONES[comprobante.receptorCondicionIva] ??
        comprobante.receptorCondicionIva,
    ],
    ["Domicilio", comprobante.receptorDomicilio || "—"],
  ];

  datos.forEach(([etiqueta, valor], i) => {
    const x = MARGEN + 8 + (i % 2) * columna;
    const yFila = cursor - 26 - Math.floor(i / 2) * 20;

    escribir(hoja, etiqueta, { x, y: yFila, tamano: 6, color: TINTA_SUAVE });
    escribir(hoja, valor, { x, y: yFila - 9, tamano: 8.5, fuente: hoja.negrita });
  });

  cursor -= altoReceptor + mm(6);

  // Detalle
  // Las columnas de la derecha llevan importes con signo de peso y separador de
  // miles, así que necesitan más aire del que parece: con menos, "21%" y
  // "$ 153.900" se tocan y el renglón deja de leerse.
  const colCantidad = MARGEN + mm(98);
  const colUnidad = MARGEN + mm(118);
  const colPrecio = MARGEN + mm(148);
  const colIva = MARGEN + mm(160);
  const colSubtotal = derecha;

  escribir(hoja, "DESCRIPCIÓN", {
    x: MARGEN,
    y: cursor,
    tamano: 6,
    fuente: hoja.negrita,
    color: TINTA_SUAVE,
  });
  escribir(hoja, "CANT.", { x: colCantidad, y: cursor, tamano: 6, fuente: hoja.negrita, color: TINTA_SUAVE, derecha: true });
  escribir(hoja, "UNIDAD", { x: colUnidad, y: cursor, tamano: 6, fuente: hoja.negrita, color: TINTA_SUAVE, derecha: true });
  escribir(hoja, "P. UNIT.", { x: colPrecio, y: cursor, tamano: 6, fuente: hoja.negrita, color: TINTA_SUAVE, derecha: true });
  if (discrimina) {
    escribir(hoja, "IVA", { x: colIva, y: cursor, tamano: 6, fuente: hoja.negrita, color: TINTA_SUAVE, derecha: true });
  }
  escribir(hoja, "SUBTOTAL", { x: colSubtotal, y: cursor, tamano: 6, fuente: hoja.negrita, color: TINTA_SUAVE, derecha: true });

  cursor -= 6;
  linea(hoja, cursor, { grosor: 1, color: TINTA });
  cursor -= 14;

  for (const item of comprobante.items) {
    const alto = escribirParrafo(hoja, item.descripcion, {
      x: MARGEN,
      y: cursor,
      ancho: mm(100),
      tamano: 8.5,
    });

    escribir(hoja, String(Number(item.cantidad)), { x: colCantidad, y: cursor, tamano: 8.5, fuente: hoja.mono, derecha: true });
    escribir(hoja, formatearUnidad(item.unidad), { x: colUnidad, y: cursor, tamano: 8, derecha: true });
    escribir(hoja, moneda.format(Number(item.precioUnitario)), { x: colPrecio, y: cursor, tamano: 8.5, fuente: hoja.mono, derecha: true });
    if (discrimina) {
      escribir(hoja, `${Number(item.alicuotaIva)}%`, { x: colIva, y: cursor, tamano: 8, derecha: true });
    }
    escribir(hoja, moneda.format(Number(item.subtotal)), { x: colSubtotal, y: cursor, tamano: 8.5, fuente: hoja.mono, derecha: true });

    cursor -= Math.max(alto, 12) + 4;
    linea(hoja, cursor + 8);
  }

  // Totales
  cursor -= mm(6);
  const xEtiqueta = derecha - mm(60);

  const filasTotales: [string, string][] = [];

  // En la B el IVA existe: se calcula, se informa a ARCA y está dentro del
  // precio. Lo que no se hace es discriminarlo en el papel.
  if (discrimina) {
    filasTotales.push(["Neto gravado", moneda.format(Number(comprobante.neto))]);
    if (Number(comprobante.iva21) > 0) {
      filasTotales.push(["IVA 21%", moneda.format(Number(comprobante.iva21))]);
    }
    if (Number(comprobante.iva105) > 0) {
      filasTotales.push(["IVA 10,5%", moneda.format(Number(comprobante.iva105))]);
    }
    // La del 27 % es rara pero existe: luz, gas y telefonía a inscriptos. Si
    // no se imprime, el papel no cuadra contra el total.
    if (Number(comprobante.iva27 ?? 0) > 0) {
      filasTotales.push([
        "IVA 27%",
        moneda.format(Number(comprobante.iva27)),
      ]);
    }
  }

  if (Number(comprobante.exento) > 0) {
    filasTotales.push(["Exento", moneda.format(Number(comprobante.exento))]);
  }

  for (const tributo of comprobante.tributos) {
    filasTotales.push([
      `${tributo.descripcion} ${Number(tributo.alicuota)}%`,
      moneda.format(Number(tributo.importe)),
    ]);
  }

  for (const [etiqueta, valor] of filasTotales) {
    escribir(hoja, etiqueta, { x: xEtiqueta, y: cursor, tamano: 8.5, color: TINTA_SUAVE });
    escribir(hoja, valor, { x: derecha, y: cursor, tamano: 8.5, fuente: hoja.mono, derecha: true });
    cursor -= 12;
  }

  hoja.pagina.drawLine({
    start: { x: xEtiqueta, y: cursor + 4 },
    end: { x: derecha, y: cursor + 4 },
    thickness: 1.5,
    color: NARANJA,
  });
  cursor -= 12;

  escribir(hoja, "TOTAL", { x: xEtiqueta, y: cursor, tamano: 12, fuente: hoja.negrita });
  escribir(hoja, moneda.format(Number(comprobante.total)), {
    x: derecha,
    y: cursor,
    tamano: 13,
    fuente: hoja.negrita,
    derecha: true,
  });

  cursor -= mm(10);

  if (comprobante.observaciones) {
    cursor -= escribirParrafo(hoja, comprobante.observaciones, {
      x: MARGEN,
      y: cursor,
      ancho: mm(120),
      tamano: 8,
      color: TINTA_SUAVE,
    });
    cursor -= 8;
  }

  // Pie fiscal
  const yPie = MARGEN + mm(24);
  linea(hoja, yPie + mm(6));

  if (comprobante.cae && emisor?.cuit) {
    const png = await qrPng({
      fecha: comprobante.fechaEmision,
      cuitEmisor: emisor.cuit,
      puntoVenta: comprobante.puntoVenta,
      tipo: comprobante.tipo,
      numero: comprobante.numero,
      total: Number(comprobante.total),
      receptorCuit: comprobante.receptorCuit,
      cae: comprobante.cae,
    });

    const imagen = await hoja.doc.embedPng(png);
    const lado = mm(22);

    hoja.pagina.drawImage(imagen, {
      x: MARGEN,
      y: yPie - mm(4),
      width: lado,
      height: lado,
    });

    escribir(hoja, `CAE ${comprobante.cae}`, {
      x: MARGEN + lado + 12,
      y: yPie + mm(12),
      tamano: 9,
      fuente: hoja.negrita,
    });

    if (comprobante.caeVencimiento) {
      escribir(
        hoja,
        `Vencimiento del CAE: ${fechaSolaCorta.format(comprobante.caeVencimiento)}`,
        { x: MARGEN + lado + 12, y: yPie + mm(8), tamano: 8, color: TINTA_SUAVE },
      );
    }

    escribir(hoja, "Comprobante autorizado por ARCA", {
      x: MARGEN + lado + 12,
      y: yPie + mm(4),
      tamano: 7,
      color: TINTA_SUAVE,
    });
  } else {
    recuadro(hoja, {
      x: MARGEN,
      y: yPie,
      ancho: A4.ancho - MARGEN * 2,
      alto: mm(12),
      grosor: 1,
      color: NARANJA,
    });

    escribir(
      hoja,
      "Comprobante sin autorización de ARCA — no válido como factura",
      { x: MARGEN + 10, y: yPie + mm(4.5), tamano: 9, fuente: hoja.negrita },
    );
  }

  return serializar(hoja);
}
