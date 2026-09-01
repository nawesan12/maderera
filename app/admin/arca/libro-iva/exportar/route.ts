import { NextResponse, type NextRequest } from "next/server";
import { libroIvaVentas } from "@/lib/dal/admin/facturacion";
import { requireStaff } from "@/lib/dal/session";
import { nombreComprobante, numeroFormateado } from "@/lib/fiscal/comprobantes";

/**
 * Libro IVA ventas en CSV, para mandarle al contador.
 *
 * Separado por punto y coma y con coma decimal: es lo que espera Excel en
 * español. Con coma como separador, un importe como "1.234,56" rompe las
 * columnas y hay que rearmar el archivo a mano.
 */
export async function GET(request: NextRequest) {
  await requireStaff();

  const periodo = request.nextUrl.searchParams.get("periodo") ?? "";
  const hoy = new Date();
  const [anioTexto, mesTexto] = periodo.split("-");
  const anio = Number(anioTexto) || hoy.getFullYear();
  const mes = Number(mesTexto) || hoy.getMonth() + 1;

  const desde = new Date(anio, mes - 1, 1, 0, 0, 0, 0);
  const hasta = new Date(anio, mes, 0, 23, 59, 59, 999);

  const libro = await libroIvaVentas(desde, hasta);

  const numero = (valor: number) => valor.toFixed(2).replace(".", ",");
  const texto = (valor: string | null) => `"${(valor ?? "").replace(/"/g, '""')}"`;

  const lineas = [
    [
      "Fecha",
      "Tipo",
      "Numero",
      "Cliente",
      "CUIT",
      "Neto",
      "IVA 21%",
      "IVA 10,5%",
      "Exento",
      "Percepciones",
      "Total",
      "CAE",
    ].join(";"),
  ];

  for (const fila of libro.filas) {
    lineas.push(
      [
        fila.fechaEmision.toISOString().slice(0, 10),
        texto(nombreComprobante(fila.tipo)),
        texto(numeroFormateado(fila.puntoVenta, fila.numero)),
        texto(fila.receptorNombre),
        texto(fila.receptorCuit),
        numero(fila.neto),
        numero(fila.iva21),
        numero(fila.iva105),
        numero(fila.exento),
        numero(fila.tributos),
        numero(fila.total),
        texto(fila.cae),
      ].join(";"),
    );
  }

  lineas.push(
    [
      "",
      "",
      "",
      texto("TOTALES"),
      "",
      numero(libro.totales.neto),
      numero(libro.totales.iva21),
      numero(libro.totales.iva105),
      numero(libro.totales.exento),
      numero(libro.totales.tributos),
      numero(libro.totales.total),
      "",
    ].join(";"),
  );

  // El BOM hace que Excel abra el archivo en UTF-8 y no rompa los acentos.
  const contenido = "﻿" + lineas.join("\n");

  return new NextResponse(contenido, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="libro-iva-ventas-${anio}-${String(mes).padStart(2, "0")}.csv"`,
    },
  });
}
