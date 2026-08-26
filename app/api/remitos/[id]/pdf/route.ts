import { NextResponse } from "next/server";
import { getSession } from "@/lib/dal/session";
import { clienteDeLaSesion } from "@/lib/dal/cuenta";
import { remitoCompleto } from "@/lib/dal/admin/entregas";
import { obtenerConfiguracionFiscal } from "@/lib/fiscal/emitir";
import { remitoPdf } from "@/lib/pdf/remito";

/** Descarga del remito en PDF. Misma regla de propiedad que el comprobante. */
export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const sesion = await getSession();

  if (!sesion) return new NextResponse("No encontrado", { status: 404 });

  const [remito, emisor] = await Promise.all([
    remitoCompleto(id),
    obtenerConfiguracionFiscal(),
  ]);

  if (!remito) return new NextResponse("No encontrado", { status: 404 });

  if (sesion.role !== "staff") {
    const cliente = await clienteDeLaSesion();
    if (!cliente || remito.customerId !== cliente.id) {
      return new NextResponse("No encontrado", { status: 404 });
    }
  }

  const pdf = await remitoPdf(remito, emisor);

  return new NextResponse(pdf as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${remito.numero}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
