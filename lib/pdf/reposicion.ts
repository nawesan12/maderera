import "server-only";

import {
  A4,
  MARGEN,
  TINTA,
  TINTA_SUAVE,
  escribir,
  escribirCentrado,
  linea,
  mm,
  nuevaHoja,
  serializar,
} from "./hoja";
import { fechaSolaCorta } from "@/lib/formato";
import type { ReporteDeReposicion } from "@/lib/dal/admin/reposicion";

/**
 * El reporte de reposición en papel: la hoja con la que se sale a comprar.
 *
 * Solo lo accionable —lo que tiene compra sugerida—, ordenado por urgencia.
 * El detalle completo, con lo que no se movió, va en el CSV: una hoja de
 * compras con trescientos renglones que dicen "cero" no se lee.
 */
export async function reposicionPdf(
  reporte: ReporteDeReposicion,
): Promise<Uint8Array> {
  const hoja = await nuevaHoja();
  const derecha = A4.ancho - MARGEN;

  let y = A4.alto - MARGEN - 6;

  escribir(hoja, "Reposición sugerida", {
    x: MARGEN,
    y,
    tamano: 14,
    fuente: hoja.negrita,
  });
  escribir(hoja, `Emitido el ${fechaSolaCorta.format(new Date())}`, {
    x: derecha,
    y,
    tamano: 8,
    color: TINTA_SUAVE,
    derecha: true,
  });
  y -= 13;

  escribir(
    hoja,
    `Ventas de los últimos ${reporte.diasDelPeriodo} días contra el stock disponible, para cubrir ${reporte.coberturaObjetivo} días.`,
    { x: MARGEN, y, tamano: 8.5, color: TINTA_SUAVE },
  );
  y -= mm(7);

  const paraComprar = reporte.filas.filter((f) => f.sugerido > 0);

  if (paraComprar.length === 0) {
    escribir(hoja, "Con el stock de hoy no hay nada urgente para comprar.", {
      x: MARGEN,
      y,
      tamano: 10,
    });
    return serializar(hoja);
  }

  const colCentral = derecha - mm(58);
  const colAserradero = derecha - mm(44);
  const colVendido = derecha - mm(30);
  const colComprar = derecha;

  const encabezado = (c: number): number => {
    escribir(hoja, "PRODUCTO", {
      x: MARGEN,
      y: c,
      tamano: 6,
      fuente: hoja.negrita,
      color: TINTA_SUAVE,
    });
    for (const [x, texto] of [
      [colCentral, "CENTRAL"],
      [colAserradero, "ASERR."],
      [colVendido, "VENDIDO"],
      [colComprar, "COMPRAR"],
    ] as const) {
      escribir(hoja, texto, {
        x,
        y: c,
        tamano: 6,
        fuente: hoja.negrita,
        color: TINTA_SUAVE,
        derecha: true,
      });
    }
    linea(hoja, c - 5, { grosor: 1, color: TINTA });
    return c - 16;
  };

  y = encabezado(y);

  for (const f of paraComprar) {
    if (y < MARGEN + mm(14)) {
      hoja.pagina = hoja.doc.addPage([A4.ancho, A4.alto]);
      y = encabezado(A4.alto - MARGEN);
    }

    const nombre = `${f.producto} — ${f.medida}${f.rubro ? ` (${f.rubro})` : ""}`;
    escribir(hoja, nombre.length > 68 ? `${nombre.slice(0, 67)}…` : nombre, {
      x: MARGEN,
      y,
      tamano: 8.5,
    });

    for (const [x, valor] of [
      [colCentral, String(f.disponibleCentral)],
      [colAserradero, String(f.disponibleAserradero)],
      [colVendido, String(f.vendido)],
    ] as const) {
      escribir(hoja, valor, {
        x,
        y,
        tamano: 8.5,
        fuente: hoja.mono,
        derecha: true,
      });
    }
    escribir(hoja, String(f.sugerido), {
      x: colComprar,
      y,
      tamano: 9.5,
      fuente: hoja.negrita,
      derecha: true,
    });

    y -= 13;
    linea(hoja, y + 6);
  }

  escribirCentrado(
    hoja,
    "La compra sugerida sale del ritmo de venta del período; un producto estacional puede pedir de más o de menos.",
    { centroX: A4.ancho / 2, y: MARGEN, tamano: 6.5, color: TINTA_SUAVE },
  );

  return serializar(hoja);
}
