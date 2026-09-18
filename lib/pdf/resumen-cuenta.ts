import "server-only";

import {
  A4,
  LINEA,
  MARGEN,
  TINTA,
  TINTA_SUAVE,
  encabezadoEmisor,
  escribir,
  linea,
  mm,
  nuevaHoja,
  serializar,
  type Hoja,
} from "@/lib/pdf/hoja";
import type { ResumenDeCuenta } from "@/lib/dal/admin/resumen-cuenta";
import { rgb } from "pdf-lib";

/**
 * El resumen de cuenta corriente, en PDF.
 *
 * Lo pidió la clienta —«poder descargar resumen de cuenta de cada cliente»— y
 * la pantalla imprimible que había no alcanzaba: imprimir desde el navegador da
 * una hoja, no un archivo, y lo que hace falta es **adjuntarlo a un correo o
 * mandarlo por WhatsApp** cuando se reclama una deuda. Es el mismo caso que ya
 * habían resuelto el comprobante y el remito.
 *
 * Lleva todos los movimientos con su saldo corrido —un resumen que empieza en
 * el medio no se puede seguir— y arriba la antigüedad de la deuda, que es lo
 * que convierte «debe $800.000» en «hay $300.000 de hace más de 90 días».
 */
export async function resumenDeCuentaPdf(
  resumen: ResumenDeCuenta,
  emisor: {
    razonSocial?: string | null;
    nombreFantasia?: string | null;
    domicilio?: string | null;
    cuit?: string | null;
  } | null,
  hoy: Date = new Date(),
): Promise<Uint8Array> {
  const hoja = await nuevaHoja();
  const anchoUtil = A4.ancho - MARGEN * 2;

  let y = encabezadoEmisor(hoja, emisor, hoja.y);

  escribir(hoja, "RESUMEN DE CUENTA", {
    x: A4.ancho - MARGEN,
    y: hoja.y,
    tamano: 15,
    fuente: hoja.negrita,
    derecha: true,
  });
  escribir(hoja, `Al ${hoy.toLocaleDateString("es-AR")}`, {
    x: A4.ancho - MARGEN,
    y: hoja.y - 16,
    tamano: 8,
    color: TINTA_SUAVE,
    derecha: true,
  });

  y -= 10;
  linea(hoja, y);
  y -= 16;

  // El cliente.
  escribir(hoja, resumen.cliente.razonSocial || resumen.cliente.nombre, {
    x: MARGEN,
    y,
    tamano: 11,
    fuente: hoja.negrita,
  });
  y -= 13;

  for (const dato of [
    resumen.cliente.cuit ? `CUIT ${resumen.cliente.cuit}` : null,
    resumen.cliente.direccion,
  ]) {
    if (!dato) continue;
    escribir(hoja, dato, { x: MARGEN, y, tamano: 8, color: TINTA_SUAVE });
    y -= 11;
  }

  y -= 6;

  /*
   * El saldo y su antigüedad.
   *
   * Los dos juntos y en ese orden: «debe $800.000» es un número, y «de los
   * cuales $300.000 tienen más de 90 días» es lo que decide si hay que llamar
   * hoy o puede esperar.
   */
  hoja.pagina.drawRectangle({
    x: MARGEN,
    y: y - mm(13),
    width: anchoUtil,
    height: mm(15),
    color: rgb(0.98, 0.97, 0.95),
  });

  escribir(hoja, resumen.saldo > 0 ? "Saldo deudor" : "Saldo", {
    x: MARGEN + mm(4),
    y: y - mm(4),
    tamano: 8,
    color: TINTA_SUAVE,
  });
  escribir(hoja, pesos(Math.abs(resumen.saldo)), {
    x: MARGEN + mm(4),
    y: y - mm(10.5),
    tamano: 16,
    fuente: hoja.negrita,
  });

  if (resumen.saldo < 0) {
    escribir(hoja, "a favor del cliente", {
      x: MARGEN + mm(4) + mm(38),
      y: y - mm(10.5),
      tamano: 8,
      color: TINTA_SUAVE,
    });
  }

  // Los tramos de antigüedad, a la derecha del saldo.
  const conDeuda = resumen.aging.tramos.filter((t) => t.monto > 0);
  const anchoTramo = mm(30);
  let x = A4.ancho - MARGEN - anchoTramo * conDeuda.length;

  for (const tramo of conDeuda) {
    escribir(hoja, tramo.etiqueta, {
      x,
      y: y - mm(4),
      tamano: 7,
      color: TINTA_SUAVE,
    });
    escribir(hoja, pesos(tramo.monto), {
      x,
      y: y - mm(10.5),
      tamano: 10,
      fuente: hoja.negrita,
    });
    x += anchoTramo;
  }

  y -= mm(20);

  if (resumen.aging.diasDeLaMasVieja !== null) {
    escribir(
      hoja,
      `La deuda más vieja sin cancelar tiene ${resumen.aging.diasDeLaMasVieja} ${
        resumen.aging.diasDeLaMasVieja === 1 ? "día" : "días"
      }.`,
      { x: MARGEN, y, tamano: 8, color: TINTA_SUAVE },
    );
    y -= 16;
  }

  // Los movimientos, con el saldo corrido.
  const columnas: { titulo: string; ancho: number; derecha?: boolean }[] = [
    { titulo: "Fecha", ancho: mm(22) },
    { titulo: "Concepto", ancho: mm(72) },
    { titulo: "Comprobante", ancho: mm(38) },
    { titulo: "Importe", ancho: mm(26), derecha: true },
    { titulo: "Saldo", ancho: mm(24), derecha: true },
  ];

  function encabezadoDeTabla() {
    let cx = MARGEN;
    for (const columna of columnas) {
      escribir(hoja, columna.titulo.toUpperCase(), {
        x: columna.derecha ? cx + columna.ancho : cx,
        y,
        tamano: 6.5,
        color: TINTA_SUAVE,
        derecha: columna.derecha,
      });
      cx += columna.ancho;
    }

    y -= 5;
    hoja.pagina.drawLine({
      start: { x: MARGEN, y },
      end: { x: A4.ancho - MARGEN, y },
      thickness: 0.5,
      color: LINEA,
    });
    y -= 11;
  }

  encabezadoDeTabla();

  for (const movimiento of resumen.movimientos) {
    if (y < MARGEN + mm(18)) {
      hoja.pagina = hoja.doc.addPage([A4.ancho, A4.alto]);
      y = A4.alto - MARGEN;
      encabezadoDeTabla();
    }

    const celdas = [
      movimiento.fecha.toLocaleDateString("es-AR"),
      movimiento.detalle || CONCEPTOS[movimiento.tipo] || movimiento.tipo,
      movimiento.referencia ?? "—",
      pesos(movimiento.monto),
      pesos(movimiento.saldo),
    ];

    let cx = MARGEN;
    celdas.forEach((celda, i) => {
      const columna = columnas[i];
      escribir(hoja, recortar(hoja, celda, columna.ancho - 4), {
        x: columna.derecha ? cx + columna.ancho : cx,
        y,
        tamano: 8,
        color: TINTA,
        derecha: columna.derecha,
      });
      cx += columna.ancho;
    });

    y -= 12;
  }

  y -= 8;
  escribir(
    hoja,
    "Los importes son finales, con IVA. Si ya pagaste alguno de estos comprobantes, avisanos y lo revisamos.",
    { x: MARGEN, y, tamano: 7.5, color: TINTA_SUAVE },
  );

  return serializar(hoja);
}

/** Cómo se lee cada tipo de movimiento cuando no tiene detalle escrito. */
const CONCEPTOS: Record<string, string> = {
  compra: "Compra",
  pago: "Pago recibido",
  nota_credito: "Nota de crédito",
  nota_debito: "Nota de débito",
  ajuste: "Ajuste",
};

/** Con signo y separador de miles, como se leen los pesos acá. */
function pesos(valor: number): string {
  return valor.toLocaleString("es-AR", {
    style: "currency",
    currency: "ARS",
    minimumFractionDigits: 2,
  });
}

/** Corta el texto que no entra en su columna, con puntos suspensivos. */
function recortar(hoja: Hoja, texto: string, ancho: number): string {
  let recortado = texto;

  while (
    recortado.length > 3 &&
    hoja.normal.widthOfTextAtSize(recortado, 8) > ancho
  ) {
    recortado = recortado.slice(0, -2);
  }

  return recortado === texto ? texto : `${recortado}…`;
}
