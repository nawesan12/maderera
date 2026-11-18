import { NextResponse, type NextRequest } from "next/server";
import { api } from "@/lib/api/servidor";
import { leerPeriodoMensual } from "@/lib/periodos";

/**
 * El Libro IVA Digital del mes (RG 4597): un .zip con VENTAS_CBTE,
 * VENTAS_ALICUOTAS, COMPRAS_CBTE y COMPRAS_ALICUOTAS en el ancho fijo que
 * importa el aplicativo de ARCA. Lo arma Go (internal/fiscal/libroiva.go).
 */
export async function GET(request: NextRequest) {
  const crudo = request.nextUrl.searchParams.get("periodo");
  const r = await (await api()).GET("/api/v1/admin/facturacion/libro-iva/digital", {
    params: { query: crudo ? { periodo: crudo } : {} },
    parseAs: "arrayBuffer",
  });
  if (!r.response.ok || !r.data) {
    return new NextResponse("No se pudo armar el archivo.", { status: r.response.status === 403 ? 403 : 500 });
  }
  const periodo = leerPeriodoMensual(crudo, new Date());
  return new NextResponse(r.data, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="libro-iva-digital-${periodo.clave}.zip"`,
      "Cache-Control": "private, no-store",
    },
  });
}
