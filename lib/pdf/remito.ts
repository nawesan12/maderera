import "server-only";

import {
  A4,
  LINEA,
  MARGEN,
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
import { fechaHora, fechaSolaCorta, formatearUnidad } from "@/lib/formato";
import type { RemitoCompleto } from "@/lib/dal/admin/entregas";

/**
 * El remito en PDF.
 *
 * **Sin importes.** Un remito documenta qué salió del depósito y quién lo
 * recibió, no cuánto costó: el flete que retira la mercadería no tiene por qué
 * ver lo que pagó el cliente. El dinero va en la factura.
 *
 * La firma se dibuja si está: se guarda como PNG en base64 dentro del propio
 * remito, así que no hay que ir a buscarla a ningún lado ni depende de que una
 * URL siga viva.
 */
export async function remitoPdf(
  remito: RemitoCompleto,
  emisor: {
    razonSocial?: string | null;
    nombreFantasia?: string | null;
    domicilio?: string | null;
    cuit?: string | null;
  } | null,
): Promise<Uint8Array> {
  const hoja = await nuevaHoja();
  const derecha = A4.ancho - MARGEN;

  if (remito.estado === "anulada") marcaDeAgua(hoja, "Anulado");

  const finEmisor = encabezadoEmisor(hoja, emisor, A4.alto - MARGEN - 10);

  if (remito.sucursal) {
    escribir(
      hoja,
      `${remito.sucursal}${remito.sucursalDireccion ? ` · ${remito.sucursalDireccion}` : ""}`,
      { x: MARGEN, y: finEmisor, tamano: 7.5, color: TINTA_SUAVE },
    );
  }

  // Letra R en recuadro, como en el comprobante fiscal: los dos papeles de la
  // casa se reconocen igual.
  const anchoCaja = mm(18);
  const altoCaja = mm(16);
  const xCaja = (A4.ancho - anchoCaja) / 2;
  const yCaja = A4.alto - MARGEN - altoCaja - 4;

  recuadro(hoja, { x: xCaja, y: yCaja, ancho: anchoCaja, alto: altoCaja, grosor: 1.5 });
  escribirCentrado(hoja, "R", {
    centroX: xCaja + anchoCaja / 2,
    y: yCaja + mm(5.5),
    tamano: 26,
    fuente: hoja.negrita,
  });
  escribirCentrado(hoja, "REMITO", {
    centroX: xCaja + anchoCaja / 2,
    y: yCaja + mm(2),
    tamano: 5,
    color: TINTA_SUAVE,
  });

  let y = A4.alto - MARGEN - 10;
  escribir(hoja, "Remito de entrega", {
    x: derecha,
    y,
    tamano: 11,
    fuente: hoja.negrita,
    derecha: true,
  });
  y -= 15;

  escribir(hoja, remito.numero, {
    x: derecha,
    y,
    tamano: 13,
    fuente: hoja.mono,
    derecha: true,
  });
  y -= 13;

  for (const texto of [
    `Fecha ${fechaSolaCorta.format(remito.createdAt)}`,
    `Pedido ${remito.pedidoNumero}`,
    remito.tipo === "envio" ? "Envío a domicilio" : "Retiro en sucursal",
  ]) {
    escribir(hoja, texto, {
      x: derecha,
      y,
      tamano: 7.5,
      color: TINTA_SUAVE,
      derecha: true,
    });
    y -= 10;
  }

  // Destinatario
  let cursor = Math.min(finEmisor, yCaja) - mm(8);
  const altoCaja2 = mm(20);

  recuadro(hoja, {
    x: MARGEN,
    y: cursor - altoCaja2,
    ancho: A4.ancho - MARGEN * 2,
    alto: altoCaja2,
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
    ["Cliente", remito.clienteNombre],
    ["Retira", remito.receptorNombre || "—"],
    ["Domicilio de entrega", remito.clienteDireccion || "—"],
    ["Documento", remito.receptorDocumento || "—"],
  ];

  if (remito.transportista) {
    datos.push([
      "Transporte",
      `${remito.transportista}${remito.numeroSeguimiento ? ` · ${remito.numeroSeguimiento}` : ""}`,
    ]);
  }

  datos.forEach(([etiqueta, valor], i) => {
    const x = MARGEN + 8 + (i % 2) * columna;
    const yFila = cursor - 26 - Math.floor(i / 2) * 20;
    escribir(hoja, etiqueta, { x, y: yFila, tamano: 6, color: TINTA_SUAVE });
    escribir(hoja, valor, { x, y: yFila - 9, tamano: 8.5, fuente: hoja.negrita });
  });

  cursor -= altoCaja2 + mm(6);

  // Detalle, sin precios
  const colCantidad = derecha - mm(30);

  escribir(hoja, "DESCRIPCIÓN", {
    x: MARGEN,
    y: cursor,
    tamano: 6,
    fuente: hoja.negrita,
    color: TINTA_SUAVE,
  });
  escribir(hoja, "CANTIDAD", {
    x: colCantidad,
    y: cursor,
    tamano: 6,
    fuente: hoja.negrita,
    color: TINTA_SUAVE,
    derecha: true,
  });
  escribir(hoja, "UNIDAD", {
    x: derecha,
    y: cursor,
    tamano: 6,
    fuente: hoja.negrita,
    color: TINTA_SUAVE,
    derecha: true,
  });

  cursor -= 6;
  linea(hoja, cursor, { grosor: 1, color: TINTA });
  cursor -= 14;

  for (const item of remito.lineas) {
    const alto = escribirParrafo(hoja, item.descripcion, {
      x: MARGEN,
      y: cursor,
      ancho: mm(120),
      tamano: 9,
    });

    escribir(hoja, String(item.cantidad), {
      x: colCantidad,
      y: cursor,
      tamano: 9,
      fuente: hoja.mono,
      derecha: true,
    });
    escribir(hoja, formatearUnidad(item.unidad), {
      x: derecha,
      y: cursor,
      tamano: 8.5,
      derecha: true,
    });

    cursor -= Math.max(alto, 12) + 4;
    linea(hoja, cursor + 8);
  }

  if (remito.notas) {
    cursor -= mm(6);
    cursor -= escribirParrafo(hoja, remito.notas, {
      x: MARGEN,
      y: cursor,
      ancho: mm(120),
      tamano: 8,
      color: TINTA_SUAVE,
    });
  }

  // Firmas
  const yFirma = MARGEN + mm(34);
  const anchoFirma = (A4.ancho - MARGEN * 2 - mm(10)) / 2;

  escribir(hoja, "FIRMA DE QUIEN RECIBE", {
    x: MARGEN,
    y: yFirma + mm(26),
    tamano: 6,
    fuente: hoja.negrita,
    color: TINTA_SUAVE,
  });

  if (remito.firmaUrl?.startsWith("data:image/png;base64,")) {
    try {
      const base64 = remito.firmaUrl.split(",")[1] ?? "";
      const imagen = await hoja.doc.embedPng(Buffer.from(base64, "base64"));
      const escala = Math.min(
        anchoFirma / imagen.width,
        mm(22) / imagen.height,
      );

      hoja.pagina.drawImage(imagen, {
        x: MARGEN,
        y: yFirma + mm(2),
        width: imagen.width * escala,
        height: imagen.height * escala,
      });
    } catch {
      // Una firma que no se puede decodificar no puede voltear la descarga del
      // remito entero: se cae al recuadro en blanco, como si no estuviera.
    }
  }

  hoja.pagina.drawLine({
    start: { x: MARGEN, y: yFirma },
    end: { x: MARGEN + anchoFirma, y: yFirma },
    thickness: 0.5,
    color: LINEA,
  });

  if (remito.firmadoAt) {
    escribir(
      hoja,
      `Firmado el ${fechaHora.format(remito.firmadoAt)}${remito.receptorNombre ? ` por ${remito.receptorNombre}` : ""}`,
      { x: MARGEN, y: yFirma - 11, tamano: 7, color: TINTA_SUAVE },
    );
  }

  const xSegunda = MARGEN + anchoFirma + mm(10);

  escribir(hoja, "ACLARACIÓN Y DOCUMENTO", {
    x: xSegunda,
    y: yFirma + mm(26),
    tamano: 6,
    fuente: hoja.negrita,
    color: TINTA_SUAVE,
  });

  hoja.pagina.drawLine({
    start: { x: xSegunda, y: yFirma },
    end: { x: derecha, y: yFirma },
    thickness: 0.5,
    color: LINEA,
  });

  escribirCentrado(
    hoja,
    "Documento no válido como factura. Los importes se detallan en el comprobante fiscal correspondiente.",
    { centroX: A4.ancho / 2, y: MARGEN + mm(4), tamano: 7, color: TINTA_SUAVE },
  );

  return serializar(hoja);
}
