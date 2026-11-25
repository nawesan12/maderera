import { NextResponse, type NextRequest } from "next/server";
import { api } from "@/lib/api/servidor";
import { cabecerasCsv } from "@/lib/csv-excel";
import { leerPeriodoMensual } from "@/lib/periodos";

/**
 * Las retenciones practicadas del mes, en CSV. El archivo lo arma la API de
 * Go (backend/internal/compras): CSV plano y no el layout SICORE, a propósito
 * (un archivo que el aplicativo rechaza es peor que no tener archivo).
 */
export async function GET(request: NextRequest) {
  const crudo = request.nextUrl.searchParams.get("periodo");
  const r = await (await api()).GET("/api/v1/admin/compras/pagos/retenciones-csv", {
    params: { query: crudo ? { periodo: crudo } : {} },
    parseAs: "arrayBuffer",
  });
  if (!r.response.ok || !r.data) {
    return new NextResponse("No se pudo armar el archivo.", { status: r.response.status === 403 ? 403 : 500 });
  }
  const periodo = leerPeriodoMensual(crudo, new Date());
  return new NextResponse(r.data, { headers: cabecerasCsv(`retenciones-practicadas-${periodo.clave}.csv`) });
}
