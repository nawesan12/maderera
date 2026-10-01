import "server-only";

import { rgb } from "pdf-lib";
import {
  A4,
  LINEA,
  MARGEN,
  TINTA_SUAVE,
  encabezadoEmisor,
  escribir,
  escribirParrafo,
  linea,
  marcaDeAgua,
  mm,
  nuevaHoja,
  serializar,
  type Hoja,
} from "@/lib/pdf/hoja";
import type { ReciboCompleto } from "@/lib/dal/recibos";
import { NOMBRE_DEL_MEDIO, importeEnLetras } from "@/lib/cobros/partes";

/**
 * El recibo, en PDF.
 *
 * De la clienta (30/9/2026): «también emitir los recibos de cada pago». Es el
 * papel que el cliente se lleva cuando paga la cuenta, y lo que se le manda
 * por correo o WhatsApp cuando paga por transferencia.
 *
 * Lleva lo que un recibo tiene que decir para que nadie discuta después:
 * quién pagó, cuánto —en números y en letras—, con qué —cada cheque con su
 * banco, número y fecha, que es como se lo encuentra en el banco— y cómo quedó
 * la cuenta. No es un comprobante fiscal: el recibo de un pago no lleva CAE.
 */
export async function reciboPdf(
  recibo: ReciboCompleto,
  emisor: {
    razonSocial?: string | null;
    nombreFantasia?: string | null;
    domicilio?: string | null;
    cuit?: string | null;
  } | null,
): Promise<Uint8Array> {
  const hoja = await nuevaHoja();
  const anchoUtil = A4.ancho - MARGEN * 2;
  const derecha = A4.ancho - MARGEN;

  let y = await encabezadoEmisor(hoja, emisor, hoja.y);

  escribir(hoja, "RECIBO", {
    x: derecha,
    y: hoja.y,
    tamano: 15,
    fuente: hoja.negrita,
    derecha: true,
  });
  escribir(hoja, recibo.numero, {
    x: derecha,
    y: hoja.y - 16,
    tamano: 11,
    fuente: hoja.mono,
    derecha: true,
  });
  escribir(hoja, recibo.fecha.toLocaleDateString("es-AR"), {
    x: derecha,
    y: hoja.y - 28,
    tamano: 8,
    color: TINTA_SUAVE,
    derecha: true,
  });

  y = Math.min(y, hoja.y - 36) - 8;
  linea(hoja, y);
  y -= 18;

  // Quién pagó.
  escribir(hoja, "Recibimos de", { x: MARGEN, y, tamano: 8, color: TINTA_SUAVE });
  y -= 13;
  escribir(hoja, recibo.recibidoDe, { x: MARGEN, y, tamano: 12, fuente: hoja.negrita });
  y -= 12;
  for (const dato of [
    recibo.cliente?.cuit ? `CUIT ${recibo.cliente.cuit}` : null,
    recibo.cliente?.direccion,
  ]) {
    if (!dato) continue;
    escribir(hoja, dato, { x: MARGEN, y, tamano: 8, color: TINTA_SUAVE });
    y -= 11;
  }
  y -= 6;

  // Cuánto, en números y en letras: la letra es la que no se puede retocar.
  hoja.pagina.drawRectangle({
    x: MARGEN,
    y: y - mm(17),
    width: anchoUtil,
    height: mm(19),
    color: rgb(0.98, 0.97, 0.95),
  });
  escribir(hoja, "La suma de", {
    x: MARGEN + mm(4),
    y: y - mm(5),
    tamano: 8,
    color: TINTA_SUAVE,
  });
  escribir(hoja, pesos(recibo.total), {
    x: MARGEN + mm(4),
    y: y - mm(12),
    tamano: 17,
    fuente: hoja.negrita,
  });
  escribirParrafo(hoja, `Son pesos ${importeEnLetras(recibo.total)}.`, {
    x: MARGEN + mm(70),
    y: y - mm(8.5),
    ancho: anchoUtil - mm(74),
    tamano: 8.5,
  });
  y -= mm(25);

  if (recibo.concepto) {
    escribir(hoja, "En concepto de", { x: MARGEN, y, tamano: 8, color: TINTA_SUAVE });
    y -= 12;
    y -= escribirParrafo(hoja, recibo.concepto, { x: MARGEN, y, ancho: anchoUtil, tamano: 9.5 });
    y -= 8;
  }

  // Con qué pagó, parte por parte.
  escribir(hoja, "Forma de pago", { x: MARGEN, y, tamano: 8, color: TINTA_SUAVE });
  y -= 6;
  hoja.pagina.drawLine({
    start: { x: MARGEN, y },
    end: { x: derecha, y },
    thickness: 0.5,
    color: LINEA,
  });
  y -= 13;

  for (const parte of recibo.partes) {
    if (y < MARGEN + mm(45)) {
      hoja.pagina = hoja.doc.addPage([A4.ancho, A4.alto]);
      y = A4.alto - MARGEN;
    }

    escribir(hoja, NOMBRE_DEL_MEDIO[parte.medio] ?? parte.medio, {
      x: MARGEN,
      y,
      tamano: 9.5,
      fuente: hoja.negrita,
    });
    escribir(hoja, pesos(parte.importe), { x: derecha, y, tamano: 9.5, derecha: true });
    y -= 11;

    const detalle = detalleDeLaParte(parte);
    if (detalle) {
      y -= escribirParrafo(hoja, detalle, {
        x: MARGEN,
        y,
        ancho: anchoUtil - mm(40),
        tamano: 8,
        color: TINTA_SUAVE,
      });
    }
    y -= 6;
  }

  hoja.pagina.drawLine({
    start: { x: MARGEN, y: y + 2 },
    end: { x: derecha, y: y + 2 },
    thickness: 0.5,
    color: LINEA,
  });
  y -= 10;
  escribir(hoja, "Total", { x: MARGEN, y, tamano: 10, fuente: hoja.negrita });
  escribir(hoja, pesos(recibo.total), {
    x: derecha,
    y,
    tamano: 10,
    fuente: hoja.negrita,
    derecha: true,
  });
  y -= 20;

  if (recibo.saldoDespues !== null && recibo.estado === "emitido") {
    const texto =
      recibo.saldoDespues > 0.005
        ? `Saldo de la cuenta después de este pago: ${pesos(recibo.saldoDespues)}.`
        : recibo.saldoDespues < -0.005
          ? `Después de este pago la cuenta queda con ${pesos(-recibo.saldoDespues)} a favor.`
          : "Con este pago la cuenta queda saldada.";
    escribir(hoja, texto, { x: MARGEN, y, tamano: 9 });
    y -= 14;
  }

  if (recibo.partes.some((p) => p.cheque)) {
    y -= escribirParrafo(
      hoja,
      "Los cheques se reciben salvo buen cobro: si el banco rechaza alguno, el importe vuelve a la cuenta.",
      { x: MARGEN, y, ancho: anchoUtil, tamano: 7.5, color: TINTA_SUAVE },
    );
    y -= 6;
  }

  // La firma de quien recibe la plata.
  const yFirma = Math.max(MARGEN + mm(20), y - mm(22));
  hoja.pagina.drawLine({
    start: { x: derecha - mm(70), y: yFirma },
    end: { x: derecha, y: yFirma },
    thickness: 0.5,
    color: TINTA_SUAVE,
  });
  escribir(hoja, recibo.emitidoPor ? `Recibió: ${recibo.emitidoPor}` : "Firma y aclaración", {
    x: derecha - mm(70),
    y: yFirma - 10,
    tamano: 7.5,
    color: TINTA_SUAVE,
  });

  escribir(hoja, "Documento no válido como factura.", {
    x: MARGEN,
    y: MARGEN,
    tamano: 7,
    color: TINTA_SUAVE,
  });

  if (recibo.estado === "anulado") {
    marcarAnulado(hoja, recibo.motivoAnulacion);
  }

  return serializar(hoja);
}

/** El detalle que identifica una parte: el cheque entero, o la operación. */
export function detalleDeLaParte(parte: ReciboCompleto["partes"][number]): string | null {
  if (parte.cheque) {
    const c = parte.cheque;
    // El medio ya dice «Cheque» arriba: acá va lo que lo identifica.
    return [
      `${c.banco ?? "Sin banco"} N° ${c.numero}`,
      `al ${c.fechaPago.toLocaleDateString("es-AR", { timeZone: "UTC" })}`,
      c.librador ? `librado por ${c.librador}` : null,
    ]
      .filter(Boolean)
      .join(" · ");
  }
  return parte.referencia ? `Operación ${parte.referencia}` : null;
}

function marcarAnulado(hoja: Hoja, motivo: string | null): void {
  for (const pagina of hoja.doc.getPages()) {
    hoja.pagina = pagina;
    marcaDeAgua(hoja, "Anulado");
  }
  if (motivo) {
    escribir(hoja, `Anulado: ${motivo}`, {
      x: MARGEN,
      y: MARGEN + 10,
      tamano: 7.5,
      color: rgb(0.7, 0.15, 0.12),
    });
  }
}

function pesos(valor: number): string {
  return valor.toLocaleString("es-AR", {
    style: "currency",
    currency: "ARS",
    minimumFractionDigits: 2,
  });
}
