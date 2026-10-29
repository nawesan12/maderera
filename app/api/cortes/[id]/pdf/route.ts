import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/dal/session";
import { hojaDelCorte } from "@/lib/dal/admin/cortes";
import { obtenerConfiguracionFiscal } from "@/lib/fiscal/emitir";
import { nombreDeLaMitad } from "@/lib/cortes/placa";
import { cortePdf } from "@/lib/pdf/corte";

/**
 * El reporte del trabajo de corte, en PDF.
 *
 * Es de taller y de mostrador, así que exige sesión de personal: el despiece de
 * un cliente dice qué está construyendo y con cuánto material, y eso no se
 * publica en una dirección adivinable.
 *
 * El plano lo rehace Go (backend/internal/cortes) con el disco y el motor del
 * trabajo; acá solo se dibuja el PDF, hasta que se mude con los demás (tanda
 * 12).
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  await requireStaff();

  const { id } = await params;
  const [datos, emisor] = await Promise.all([hojaDelCorte(id), obtenerConfiguracionFiscal()]);

  if (!datos) return new NextResponse("No encontrado", { status: 404 });
  const { corte, plano } = datos;

  const pdf = await cortePdf(
    {
      numero: corte.numero,
      cliente: corte.cliente,
      material: corte.material,
      cantoDescripcion: corte.cantoDescripcion,
      deQueSale: nombreDeLaMitad(corte.medida.mitad),
      createdAt: corte.createdAt,
      metrosCanto: datos.metrosCanto,
      superficieSierra: datos.superficies.reduce((t, x) => t + x, 0),
    },
    plano,
    emisor,
  );

  return new NextResponse(pdf as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="corte-${corte.numero}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
