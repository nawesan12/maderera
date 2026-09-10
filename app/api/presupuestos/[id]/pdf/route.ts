import { NextResponse } from "next/server";
import { getSession } from "@/lib/dal/session";
import { clienteDeLaSesion } from "@/lib/dal/cuenta";
import { consultarPresupuesto } from "@/lib/dal/admin/ventas";
import { obtenerConfiguracionFiscal } from "@/lib/fiscal/emitir";
import { datosParaTransferir } from "@/lib/dal/pagos";
import { presupuestoPdf } from "@/lib/pdf/presupuesto";

/**
 * Descarga del presupuesto en PDF.
 *
 * Misma regla de propiedad que el comprobante y el remito: personal ve todo,
 * el cliente solo lo que apunta a su ficha. Todo lo demás es 404 y no 403,
 * para no confirmar que el id existe.
 */
export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const sesion = await getSession();

  if (!sesion) return new NextResponse("No encontrado", { status: 404 });

  // Un id que no es UUID haría fallar el cast de Postgres con un 500.
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return new NextResponse("No encontrado", { status: 404 });
  }

  const [presupuesto, emisor, banco] = await Promise.all([
    consultarPresupuesto(id),
    obtenerConfiguracionFiscal(),
    datosParaTransferir(),
  ]);

  if (!presupuesto) return new NextResponse("No encontrado", { status: 404 });

  if (sesion.role !== "staff") {
    const cliente = await clienteDeLaSesion();
    if (!cliente || presupuesto.customerId !== cliente.id) {
      return new NextResponse("No encontrado", { status: 404 });
    }
  }

  const pdf = await presupuestoPdf(presupuesto, emisor, banco);

  return new NextResponse(pdf as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${presupuesto.numero}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
