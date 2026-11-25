import { NextResponse, type NextRequest } from "next/server";
import { api } from "@/lib/api/servidor";
import { cabecerasCsv } from "@/lib/csv-excel";
import { leerPeriodoMensual } from "@/lib/periodos";

/**
 * El libro IVA compras en CSV, que es como lo pide el contador. El archivo lo
 * arma la API de Go (backend/internal/compras), con la columna de si el
 * comprobante da crédito fiscal y el total computable al pie.
 */
export async function GET(request: NextRequest) {
  const crudo = request.nextUrl.searchParams.get("periodo");
  const r = await (await api()).GET("/api/v1/admin/compras/libro-iva/csv", {
    params: { query: crudo ? { periodo: crudo } : {} },
    parseAs: "arrayBuffer",
  });
  if (!r.response.ok || !r.data) {
    return new NextResponse("No se pudo armar el archivo.", { status: r.response.status === 403 ? 403 : 500 });
  }
  const periodo = leerPeriodoMensual(crudo, new Date());
  return new NextResponse(r.data, { headers: cabecerasCsv(`libro-iva-compras-${periodo.clave}.csv`) });
}
