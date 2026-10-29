import { NextResponse } from "next/server";
import { api } from "@/lib/api/servidor";

/**
 * Un remito en PDF. Lo arma Go (backend/internal/entregas) con la misma
 * regla de propiedad de siempre: lo baja el personal, y el cliente solo los
 * suyos. A quien no puede verlo se le contesta 404 y no 403: un 403 confirma
 * que el remito existe. Esta ruta queda para que la dirección no cambie.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new NextResponse("No encontrado", { status: 404 });
  const r = await (await api()).GET("/api/v1/remitos/{id}/pdf", { params: { path: { id } }, parseAs: "stream" });
  if (!r.data) return new NextResponse("No encontrado", { status: 404 });
  return new Response(r.data, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": r.response.headers.get("Content-Disposition") ?? "attachment",
      "Cache-Control": "private, no-store",
    },
  });
}
