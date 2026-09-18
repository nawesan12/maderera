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
import type { FilaDeReporte } from "@/lib/dal/admin/reportes";
import { rgb } from "pdf-lib";

/**
 * El reporte de ventas en PDF.
 *
 * **No reemplaza al CSV, lo complementa.** El CSV se abre en Excel y se trabaja;
 * esto se adjunta a un correo, se le manda al contador o se imprime para la
 * reunión, que es el otro uso y el que la clienta pidió al hablar de «mejorar
 * los reportes».
 *
 * Lleva la misma información que la pantalla y en el mismo orden: el total
 * arriba, el margen si hay costos cargados, y el detalle con su participación.
 * Los renglones sin costo se dicen —no se cuentan como costo cero— por la misma
 * razón que en pantalla: cero daría 100 % de margen y mezclaría lo que no se
 * sabe con lo que sí.
 */
export async function reporteDeVentasPdf({
  filas,
  titulo,
  periodo,
  filtros,
  emisor,
}: {
  filas: FilaDeReporte[];
  /** Por dónde está cortado: "Por producto", "Por rubro"… */
  titulo: string;
  periodo: string;
  /** Lo que acota el reporte, ya escrito: "Carpintería · Casa Central". */
  filtros: string | null;
  emisor: {
    razonSocial?: string | null;
    nombreFantasia?: string | null;
    domicilio?: string | null;
    cuit?: string | null;
  } | null;
}): Promise<Uint8Array> {
  const hoja = await nuevaHoja();
  const anchoUtil = A4.ancho - MARGEN * 2;

  let y = encabezadoEmisor(hoja, emisor, hoja.y);

  escribir(hoja, "REPORTE DE VENTAS", {
    x: A4.ancho - MARGEN,
    y: hoja.y,
    tamano: 15,
    fuente: hoja.negrita,
    derecha: true,
  });
  escribir(hoja, `${titulo} · ${periodo}`, {
    x: A4.ancho - MARGEN,
    y: hoja.y - 16,
    tamano: 8,
    color: TINTA_SUAVE,
    derecha: true,
  });

  if (filtros) {
    escribir(hoja, filtros, {
      x: A4.ancho - MARGEN,
      y: hoja.y - 27,
      tamano: 8,
      color: TINTA_SUAVE,
      derecha: true,
    });
  }

  y -= 10;
  linea(hoja, y);
  y -= 16;

  const total = filas.reduce((suma, f) => suma + f.total, 0);
  const costeado = filas.filter((f) => f.costo !== null);
  const netoTotal = costeado.reduce((s, f) => s + f.netoVenta, 0);
  const costoTotal = costeado.reduce((s, f) => s + (f.costo ?? 0), 0);
  const sinCosto = filas.reduce((s, f) => s + f.lineasSinCosto, 0);

  // Las cifras de arriba.
  const cifras: [string, string][] = [
    [pesos(total), "vendido, con IVA"],
    ...(costeado.length > 0
      ? ([
          [pesos(netoTotal), "neto sin IVA"],
          [pesos(costoTotal), "costo"],
          [
            `${Math.round(((netoTotal - costoTotal) / (netoTotal || 1)) * 100)}%`,
            "margen",
          ],
        ] as [string, string][])
      : []),
  ];

  hoja.pagina.drawRectangle({
    x: MARGEN,
    y: y - mm(11),
    width: anchoUtil,
    height: mm(13),
    color: rgb(0.98, 0.97, 0.95),
  });

  const anchoCifra = anchoUtil / cifras.length;
  cifras.forEach(([valor, rotulo], i) => {
    escribir(hoja, valor, {
      x: MARGEN + mm(3) + i * anchoCifra,
      y: y - mm(3),
      tamano: 12,
      fuente: hoja.negrita,
    });
    escribir(hoja, rotulo, {
      x: MARGEN + mm(3) + i * anchoCifra,
      y: y - mm(8),
      tamano: 7,
      color: TINTA_SUAVE,
    });
  });

  y -= mm(18);

  if (sinCosto > 0) {
    escribir(
      hoja,
      `${sinCosto} ${sinCosto === 1 ? "renglón no tiene" : "renglones no tienen"} costo cargado: el margen es sobre el resto.`,
      { x: MARGEN, y, tamano: 8, color: TINTA_SUAVE },
    );
    y -= 16;
  }

  // El detalle.
  const columnas: { titulo: string; ancho: number; derecha?: boolean }[] = [
    { titulo: titulo.replace("Por ", ""), ancho: mm(74) },
    { titulo: "Cant.", ancho: mm(18), derecha: true },
    { titulo: "Total", ancho: mm(28), derecha: true },
    { titulo: "Margen", ancho: mm(26), derecha: true },
    { titulo: "Part.", ancho: mm(16), derecha: true },
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

  for (const fila of filas) {
    if (y < MARGEN + mm(18)) {
      hoja.pagina = hoja.doc.addPage([A4.ancho, A4.alto]);
      y = A4.alto - MARGEN;
      encabezadoDeTabla();
    }

    const margen =
      fila.costo === null ? "—" : pesos(fila.netoVenta - fila.costo);
    const participacion = total > 0 ? `${Math.round((fila.total / total) * 100)}%` : "—";

    const celdas = [
      fila.etiqueta,
      Math.round(fila.cantidad).toLocaleString("es-AR"),
      pesos(fila.total),
      margen,
      participacion,
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

  return serializar(hoja);
}

function pesos(valor: number): string {
  return valor.toLocaleString("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  });
}

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
