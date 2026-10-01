import { NextResponse } from "next/server";
import { getSession } from "@/lib/dal/session";
import { clienteDeLaSesion } from "@/lib/dal/cuenta";
import { clienteDelRecibo, reciboCompleto } from "@/lib/dal/recibos";
import { obtenerConfiguracionFiscal } from "@/lib/fiscal/emitir";
import { reciboPdf } from "@/lib/pdf/recibo";

/**
 * Un recibo en PDF.
 *
 * **La misma regla de propiedad que el resumen de cuenta**: lo baja el
 * personal, y el cliente solo los suyos. Un recibo dice cuánto pagó alguien y
 * con qué cheques; con el id en la URL y sin esta comprobación, cualquiera con
 * una sesión vería los de cualquiera. A quien no puede verlo se le contesta
 * 404 y no 403: un 403 confirma que el recibo existe.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const sesion = await getSession();
  if (!sesion) return new NextResponse("No encontrado", { status: 404 });

  if (sesion.role !== "staff") {
    const [propio, dueno] = await Promise.all([clienteDeLaSesion(), clienteDelRecibo(id)]);
    if (!propio || !dueno || propio.id !== dueno) {
      return new NextResponse("No encontrado", { status: 404 });
    }
  }

  const [recibo, emisor] = await Promise.all([reciboCompleto(id), obtenerConfiguracionFiscal()]);
  if (!recibo) return new NextResponse("No encontrado", { status: 404 });

  const pdf = await reciboPdf(recibo, emisor);

  return new NextResponse(pdf as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="recibo-${recibo.numero}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
