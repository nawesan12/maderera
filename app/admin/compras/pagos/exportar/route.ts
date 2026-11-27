import { NextResponse, type NextRequest } from "next/server";
import { api } from "@/lib/api/servidor";
import { cabecerasCsv } from "@/lib/csv-excel";
import { leerPeriodoMensual } from "@/lib/periodos";

/**
 * Las retenciones practicadas del mes, en CSV. El archivo lo arma la API de
 * Go (backend/internal/compras). El TXT de importación de SICORE
 * (`formato=sicore`) sale solo con la regla exportar_sicore prendida: un
 * archivo que el aplicativo rechaza es peor que no tener archivo, y el
 * diseño de registro lo confirma el estudio.
 */
export async function GET(request: NextRequest) {
  const crudo = request.nextUrl.searchParams.get("periodo");
  const sicore = request.nextUrl.searchParams.get("formato") === "sicore";
  const r = await (await api()).GET("/api/v1/admin/compras/pagos/retenciones-csv", {
    params: { query: { ...(crudo ? { periodo: crudo } : {}), ...(sicore ? { formato: "sicore" as const } : {}) } },
    parseAs: "arrayBuffer",
  });
  if (!r.response.ok || !r.data) {
    return new NextResponse("No se pudo armar el archivo.", {
      status: r.response.status === 403 ? 403 : r.response.status === 422 ? 422 : 500,
    });
  }
  const periodo = leerPeriodoMensual(crudo, new Date());
  if (sicore) {
    return new NextResponse(r.data, {
      headers: {
        "Content-Type": "text/plain; charset=windows-1252",
        "Content-Disposition": `attachment; filename="retenciones-sicore-${periodo.clave}.txt"`,
        "Cache-Control": "no-store",
      },
    });
  }
  return new NextResponse(r.data, { headers: cabecerasCsv(`retenciones-practicadas-${periodo.clave}.csv`) });
}
