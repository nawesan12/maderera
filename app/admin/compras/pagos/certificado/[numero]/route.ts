import { NextResponse } from "next/server";
import { api } from "@/lib/api/servidor";
import { requireStaffRole } from "@/lib/dal/session";

/**
 * El certificado de retención en PDF.
 *
 * **No es un papel de cortesía:** es el comprobante con el que el proveedor se
 * computa la retención en su propia declaración. Sin él, le retuvimos plata que
 * no puede recuperar, y el reclamo llega igual pero un mes después.
 *
 * Lo arma la API de Go (backend/internal/compras con internal/pdf), con el
 * cálculo entero —base del pago, acumulado del mes, mínimo, monto sujeto,
 * alícuota y lo ya retenido—: la retención sale del acumulado del mes y con
 * la base sola no cerraba a la vista.
 *
 * La dirección lleva el número y no el id porque es lo que está impreso: quien
 * tiene el papel en la mano puede reimprimirlo sin buscar nada.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ numero: string }> },
) {
  await requireStaffRole("admin");

  const { numero } = await params;
  const r = await (await api()).GET("/api/v1/admin/compras/certificados/{numero}/pdf", {
    params: { path: { numero: decodeURIComponent(numero) } },
    parseAs: "arrayBuffer",
  });

  if (r.response.status === 404) {
    return new NextResponse("No existe ese certificado.", { status: 404 });
  }
  if (!r.response.ok || !r.data) {
    return new NextResponse("No se pudo armar el certificado.", { status: 500 });
  }

  const disposicion = r.response.headers.get("Content-Disposition") ?? "";
  const nombre = /filename="([^"]+)"/.exec(disposicion)?.[1] ?? "retencion.pdf";
  return new NextResponse(r.data, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${nombre}"`,
      // Depende de quién pregunta y no se guarda en ningún intermediario.
      "Cache-Control": "private, no-store",
    },
  });
}
