import { NextResponse } from "next/server";
import {
  comprobanteDelCliente,
  configuracionFiscalActual,
  obtenerComprobante,
} from "@/lib/dal/admin/facturacion";
import { getSession } from "@/lib/dal/session";
import { clienteDeLaSesion } from "@/lib/dal/cuenta";
import { obtenerConfiguracionFiscal } from "@/lib/fiscal/emitir";
import { comprobantePdf } from "@/lib/pdf/comprobante";
import { numeroFormateado } from "@/lib/fiscal/comprobantes";

/**
 * Descarga del comprobante en PDF (cláusula 1.6).
 *
 * La misma regla de siempre: el personal descarga cualquiera, el cliente
 * únicamente los suyos, y el filtro por dueño va dentro de la consulta. Sin
 * sesión no se responde 401 sino 404: un 401 le confirmaría a quien prueba ids
 * al azar que ese comprobante existe.
 */
export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const sesion = await getSession();

  if (!sesion) return new NextResponse("No encontrado", { status: 404 });

  const esStaff = sesion.role === "staff";

  let comprobante = null;
  let emisor = null;

  if (esStaff) {
    [comprobante, emisor] = await Promise.all([
      obtenerComprobante(id),
      configuracionFiscalActual(),
    ]);
  } else {
    const cliente = await clienteDeLaSesion();
    if (!cliente) return new NextResponse("No encontrado", { status: 404 });

    [comprobante, emisor] = await Promise.all([
      comprobanteDelCliente(id, cliente.id),
      obtenerConfiguracionFiscal(),
    ]);
  }

  if (!comprobante) return new NextResponse("No encontrado", { status: 404 });

  const pdf = await comprobantePdf(comprobante, emisor);

  const nombre = `${comprobante.tipo.toUpperCase()}-${numeroFormateado(
    comprobante.puntoVenta,
    comprobante.numero,
  ).replace(/\s/g, "")}.pdf`;

  return new NextResponse(pdf as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${nombre}"`,
      // Documentación fiscal: nunca se cachea en un intermediario compartido.
      "Cache-Control": "private, no-store",
    },
  });
}
