import { NextResponse, type NextRequest } from "next/server";
import { api } from "@/lib/api/servidor";
import { cabecerasCsv } from "@/lib/csv-excel";
import { leerPeriodoMensual } from "@/lib/periodos";

/**
 * Los asientos del mes, para que el estudio los importe: un renglón por línea,
 * con el número de asiento repetido, el código y el nombre de cada cuenta. El
 * archivo lo arma la API de Go (backend/internal/reportes/asientos.go); un
 * asiento que no cierra dice «NO CIERRA» en el archivo y no solo en la
 * pantalla.
 */
export async function GET(request: NextRequest) {
  const crudo = request.nextUrl.searchParams.get("periodo");
  const r = await (await api()).GET("/api/v1/admin/cierre/asientos-csv", {
    params: { query: crudo ? { periodo: crudo } : {} },
    parseAs: "arrayBuffer",
  });
  if (!r.response.ok || !r.data) {
    return new NextResponse("No se pudo armar el archivo.", { status: r.response.status === 403 ? 403 : 500 });
  }
  const periodo = leerPeriodoMensual(crudo, new Date());
  return new NextResponse(r.data, { headers: cabecerasCsv(`asientos-${periodo.clave}.csv`) });
}
