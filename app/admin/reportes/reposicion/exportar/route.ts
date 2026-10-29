import { NextResponse } from "next/server";
import { api } from "@/lib/api/servidor";
import { cabecerasCsv } from "@/lib/csv-excel";

/**
 * El reporte de reposición para llevar: CSV para trabajarlo, PDF para
 * imprimirlo y salir a comprar con la hoja. Los dos los arma la API de Go
 * (backend/internal/reportes), con los mismos filtros que la pantalla.
 */
export async function GET(request: Request) {
  const q = new URL(request.url).searchParams;
  const formato = q.get("formato") === "pdf" ? "pdf" : "csv";
  const query: Record<string, string> = { formato };
  for (const clave of ["dias", "objetivo", "cat", "rubro", "sucursal"]) {
    const v = q.get(clave);
    if (v) query[clave] = v;
  }
  const r = await (await api()).GET("/api/v1/admin/reportes/reposicion/archivo", {
    params: { query },
    parseAs: "arrayBuffer",
  });
  // Como antes: a quien no es del personal, «no encontrado».
  if (r.response.status === 401 || r.response.status === 403) {
    return new NextResponse("No encontrado", { status: 404 });
  }
  if (!r.response.ok || !r.data) {
    return new NextResponse("No se pudo armar el archivo.", { status: 500 });
  }
  const disposicion = r.response.headers.get("Content-Disposition") ?? "";
  const nombre = /filename="([^"]+)"/.exec(disposicion)?.[1] ?? `reposicion.${formato}`;
  if (formato === "pdf") {
    return new NextResponse(r.data, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${nombre}"`,
        "Cache-Control": "private, no-store",
      },
    });
  }
  return new NextResponse(r.data, { headers: cabecerasCsv(nombre) });
}
