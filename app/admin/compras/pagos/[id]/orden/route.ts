import { NextResponse } from "next/server";
import { api } from "@/lib/api/servidor";
import { requireStaffRole } from "@/lib/dal/session";
import { esUuid } from "@/lib/uuid";

/**
 * La orden de pago en PDF: el papel que acompaña la transferencia o los
 * cheques y que el proveedor firma de recibido. Lo arma la API de Go
 * (backend/internal/compras con internal/pdf), como el certificado.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  await requireStaffRole("admin");

  const { id } = await params;
  if (!esUuid(id)) return new NextResponse("Ese pago no existe.", { status: 404 });
  const r = await (await api()).GET("/api/v1/admin/compras/pagos/{id}/pdf", {
    params: { path: { id } },
    parseAs: "arrayBuffer",
  });

  if (r.response.status === 404) {
    return new NextResponse("Ese pago no existe.", { status: 404 });
  }
  if (!r.response.ok || !r.data) {
    return new NextResponse("No se pudo armar la orden de pago.", { status: 500 });
  }

  const disposicion = r.response.headers.get("Content-Disposition") ?? "";
  const nombre = /filename="([^"]+)"/.exec(disposicion)?.[1] ?? "orden-de-pago.pdf";
  return new NextResponse(r.data, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${nombre}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
