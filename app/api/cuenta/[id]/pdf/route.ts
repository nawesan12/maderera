import { NextResponse } from "next/server";
import { getSession } from "@/lib/dal/session";
import { clienteDeLaSesion } from "@/lib/dal/cuenta";
import { resumenDeCuenta } from "@/lib/dal/admin/resumen-cuenta";
import { obtenerConfiguracionFiscal } from "@/lib/fiscal/emitir";
import { resumenDeCuentaPdf } from "@/lib/pdf/resumen-cuenta";

/**
 * El resumen de cuenta corriente en PDF.
 *
 * **Misma regla de propiedad que el comprobante y el remito**: lo baja el
 * personal, y el cliente solo el suyo. Un resumen de cuenta dice cuánto compra
 * alguien y cuánto debe; con el id en la URL y sin esta comprobación, cualquiera
 * con una sesión vería la cuenta de cualquiera.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const sesion = await getSession();

  if (!sesion) return new NextResponse("No encontrado", { status: 404 });

  if (sesion.role !== "staff") {
    const propio = await clienteDeLaSesion();
    if (!propio || propio.id !== id) {
      return new NextResponse("No encontrado", { status: 404 });
    }
  }

  const [resumen, emisor] = await Promise.all([
    resumenDeCuenta(id),
    obtenerConfiguracionFiscal(),
  ]);

  if (!resumen) return new NextResponse("No encontrado", { status: 404 });

  const pdf = await resumenDeCuentaPdf(resumen, emisor);
  const nombre = (resumen.cliente.razonSocial || resumen.cliente.nombre)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .toLowerCase();

  return new NextResponse(pdf as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="cuenta-${nombre}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
