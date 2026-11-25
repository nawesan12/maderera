import { NextResponse } from "next/server";
import { api } from "@/lib/api/servidor";

/**
 * Descarga del comprobante en PDF (cláusula 1.6). Lo arma Go
 * (backend/internal/facturacion, con internal/pdf y el QR de ARCA) con la
 * misma regla de siempre: el personal descarga cualquiera y el cliente
 * únicamente los suyos. A quien no puede verlo se le contesta 404: un 401 o un
 * 403 le confirmaría que el comprobante existe. La ruta queda para que la
 * dirección no cambie.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new NextResponse("No encontrado", { status: 404 });
  const r = await (await api()).GET("/api/v1/comprobantes/{id}/pdf", { params: { path: { id } }, parseAs: "stream" });
  if (!r.data) return new NextResponse("No encontrado", { status: 404 });
  return new Response(r.data, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": r.response.headers.get("Content-Disposition") ?? "attachment",
      // Documentación fiscal: nunca se cachea en un intermediario compartido.
      "Cache-Control": "private, no-store",
    },
  });
}
