import { NextResponse } from "next/server";
import { staffOrNull } from "@/lib/dal/session";
import { reporteDeReposicion } from "@/lib/dal/admin/reposicion";
import { reposicionPdf } from "@/lib/pdf/reposicion";

/**
 * El reporte de reposición para llevar: CSV para trabajarlo, PDF para
 * imprimirlo y salir a comprar con la hoja. La clienta pidió los dos.
 */
export const runtime = "nodejs";

export async function GET(request: Request) {
  const usuario = await staffOrNull();
  if (!usuario) return new NextResponse("No encontrado", { status: 404 });

  const url = new URL(request.url);
  const dias = Number(url.searchParams.get("dias")) || 30;
  const objetivo = Math.min(
    Math.max(Number(url.searchParams.get("objetivo")) || 30, 7),
    180,
  );

  const reporte = await reporteDeReposicion({
    diasDelPeriodo: [30, 60, 90].includes(dias) ? dias : 30,
    coberturaObjetivo: objetivo,
    categoria: url.searchParams.get("cat") ?? undefined,
    sucursal: url.searchParams.get("sucursal") ?? undefined,
  });

  if (url.searchParams.get("formato") === "pdf") {
    const pdf = await reposicionPdf(reporte);
    return new NextResponse(pdf as BodyInit, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="reposicion-${dias}dias.pdf"`,
        "Cache-Control": "private, no-store",
      },
    });
  }

  // `;` y coma decimal, que es lo que abre bien un Excel en español.
  const encabezado = [
    "Producto",
    "Medida",
    "Código",
    "Categoría",
    "Rubro",
    "Central",
    "Aserradero",
    "Vendido",
    "Cobertura (días)",
    "Comprar",
  ].join(";");

  const filas = reporte.filas.map((f) =>
    [
      f.producto,
      f.medida,
      f.sku ?? "",
      f.categoria,
      f.rubro ?? "",
      f.disponibleCentral,
      f.disponibleAserradero,
      f.vendido,
      f.cobertura ?? "",
      f.sugerido,
    ]
      .map((v) => {
        const texto = String(v);
        return /[;"\n]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
      })
      .join(";"),
  );

  // BOM para que Excel en Windows lea bien los acentos.
  const csv = "﻿" + [encabezado, ...filas].join("\r\n");

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="reposicion-${dias}dias.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
