import { NextResponse, type NextRequest } from "next/server";
import { api } from "@/lib/api/servidor";
import { cabecerasCsv } from "@/lib/csv-excel";

/**
 * El reporte de ventas en CSV (para trabajar: `;` y coma decimal, como lo
 * espera Excel en español) o en PDF (para mandar). Los dos los arma la API de
 * Go (backend/internal/reportes) de la misma consulta y el mismo filtro que
 * la pantalla, así que no pueden decir cosas distintas.
 */
export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams;
  const formato = q.get("formato") === "pdf" ? "pdf" : "csv";
  const query = {
    formato,
    ...(q.get("corte") ? { corte: q.get("corte")! } : {}),
    ...(q.get("periodo") ? { periodo: q.get("periodo")! } : {}),
    ...(q.get("rubro") ? { rubro: q.get("rubro")! } : {}),
    ...(q.get("sucursal") ? { sucursal: q.get("sucursal")! } : {}),
  } as const;
  const r = await (await api()).GET("/api/v1/admin/reportes/ventas/archivo", {
    params: { query },
    parseAs: "arrayBuffer",
  });
  if (!r.response.ok || !r.data) {
    return new NextResponse("No se pudo armar el archivo.", { status: r.response.status === 403 ? 403 : 500 });
  }
  const disposicion = r.response.headers.get("Content-Disposition") ?? "";
  const nombre = /filename="([^"]+)"/.exec(disposicion)?.[1] ?? `ventas.${formato}`;
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
