import { NextResponse } from "next/server";
import { api } from "@/lib/api/servidor";

/**
 * Descarga del presupuesto en PDF. Lo arma Go (backend/internal/pedidos/pdf.go)
 * con la regla de siempre: el personal ve todo, el cliente solo lo que apunta
 * a su ficha, y lo demás es 404 y no 403, para no confirmar que el id existe.
 * Esta ruta queda para que la dirección no cambie.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Un id que no es UUID: Go lo rechaza con 400; acá, como siempre, 404.
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new NextResponse("No encontrado", { status: 404 });
  const r = await (await api()).GET("/api/v1/presupuestos/{id}/pdf", { params: { path: { id } }, parseAs: "stream" });
  if (!r.data) return new NextResponse("No encontrado", { status: 404 });
  return new Response(r.data, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": r.response.headers.get("Content-Disposition") ?? "attachment",
      "Cache-Control": "private, no-store",
    },
  });
}
