import { NextResponse } from "next/server";
import { api } from "@/lib/api/servidor";
import { cabecerasCsv } from "@/lib/csv-excel";

/** La deuda de cada cliente por antigüedad, en CSV para el contador. Lo arma la API de Go (internal/reportes). */
export async function GET() {
  const r = await (await api()).GET("/api/v1/admin/contador/deudores-csv", { parseAs: "arrayBuffer" });
  if (!r.response.ok || !r.data) {
    return new NextResponse("No se pudo armar el archivo.", { status: r.response.status === 403 ? 403 : 500 });
  }
  const hoy = new Date().toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" });
  return new NextResponse(r.data, { headers: cabecerasCsv(`deudores-${hoy}.csv`) });
}
