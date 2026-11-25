import { NextResponse } from "next/server";
import { api } from "@/lib/api/servidor";

/**
 * El resumen de cuenta corriente en PDF. Lo arma Go
 * (backend/internal/cuentas/pdf.go) con la misma regla de propiedad que el
 * comprobante y el remito: lo baja el personal, y el cliente solo el suyo; a
 * cualquier otro, 404. Esta ruta queda para que la dirección no cambie.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new NextResponse("No encontrado", { status: 404 });
  const r = await (await api()).GET("/api/v1/cuentas/{id}/pdf", { params: { path: { id } }, parseAs: "stream" });
  if (!r.data) return new NextResponse("No encontrado", { status: 404 });
  return new Response(r.data, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": r.response.headers.get("Content-Disposition") ?? "attachment",
      "Cache-Control": "private, no-store",
    },
  });
}
