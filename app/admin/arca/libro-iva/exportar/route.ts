import { NextResponse, type NextRequest } from "next/server";
import { api } from "@/lib/api/servidor";
import { cabecerasCsv } from "@/lib/csv-excel";
import { leerPeriodoMensual } from "@/lib/periodos";

/**
 * Libro IVA ventas en CSV, para mandarle al contador. Lo arma la API de Go
 * (backend/internal/facturacion) con internal/csvexcel, igual que el de
 * compras: punto y coma, coma decimal, BOM y la fecha en hora argentina.
 */
export async function GET(request: NextRequest) {
  const crudo = request.nextUrl.searchParams.get("periodo");
  const r = await (await api()).GET("/api/v1/admin/facturacion/libro-iva/csv", {
    params: { query: crudo ? { periodo: crudo } : {} },
    parseAs: "arrayBuffer",
  });
  if (!r.response.ok || !r.data) {
    return new NextResponse("No se pudo armar el archivo.", { status: r.response.status === 403 ? 403 : 500 });
  }
  const periodo = leerPeriodoMensual(crudo, new Date());
  return new NextResponse(r.data, { headers: cabecerasCsv(`libro-iva-ventas-${periodo.clave}.csv`) });
}
