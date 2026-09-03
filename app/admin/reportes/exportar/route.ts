import { NextResponse, type NextRequest } from "next/server";
import { requireStaff } from "@/lib/dal/session";
import { CORTES, leerCorte, reporteDeVentas } from "@/lib/dal/admin/reportes";
import { leerPeriodo, resolverPeriodo } from "@/lib/periodos";

/**
 * El reporte en CSV, que es como se lo pide de verdad.
 *
 * Separado por punto y coma y con coma decimal, igual que el libro IVA: es lo
 * que espera Excel en español. Con coma como separador, un importe como
 * "1.234,56" rompe las columnas y hay que rearmar el archivo a mano.
 */
export async function GET(request: NextRequest) {
  await requireStaff();

  const corte = leerCorte(request.nextUrl.searchParams.get("corte") ?? undefined);
  const clave = leerPeriodo(request.nextUrl.searchParams.get("periodo") ?? undefined);
  const periodo = resolverPeriodo(clave);

  const filas = await reporteDeVentas(corte, periodo);

  const numero = (valor: number) => valor.toFixed(2).replace(".", ",");
  const texto = (valor: string | null) => `"${(valor ?? "").replace(/"/g, '""')}"`;

  const encabezado = CORTES.find((c) => c.clave === corte)?.etiqueta ?? "Concepto";

  const lineas = [
    [
      texto(encabezado.replace("Por ", "")),
      texto("Detalle"),
      texto(corte === "producto" ? "Unidades" : "Operaciones"),
      texto("Total"),
    ].join(";"),
    ...filas.map((f) =>
      [
        texto(f.etiqueta),
        texto(f.detalle),
        numero(f.cantidad),
        numero(f.total),
      ].join(";"),
    ),
  ];

  const total = filas.reduce((suma, f) => suma + f.total, 0);
  lineas.push([texto("Total"), texto(""), texto(""), numero(total)].join(";"));

  // El BOM es lo que hace que Excel abra el archivo en UTF-8 y no rompa los
  // acentos. Sin él, "Melamínica" llega como "MelamÃ­nica".
  const csv = `﻿${lineas.join("\r\n")}\r\n`;

  const nombre = `ventas-${corte}-${periodo.clave}.csv`;

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${nombre}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
