import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/dal/session";
import { hojaDelCorte } from "@/lib/dal/admin/cortes";
import { nombreDeLaMitad } from "@/lib/cortes/placa";
import { hojaDeCortePdf } from "@/lib/pdf/hoja-de-corte";

/**
 * La hoja de corte para la seccionadora, en PDF.
 *
 * Personal con sesión, como el reporte. La hoja la arma Go
 * (backend/internal/cortes) del plano del trabajo, con su disco y su motor;
 * acá solo se dibuja el PDF, hasta la tanda 12.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  await requireStaff();

  const { id } = await params;
  const datos = await hojaDelCorte(id);
  if (!datos) return new NextResponse("No encontrado", { status: 404 });
  const { corte, hoja } = datos;

  const pdf = await hojaDeCortePdf(
    {
      numero: corte.numero,
      cliente: corte.cliente,
      material: corte.material,
      deQueSale: nombreDeLaMitad(corte.medida.mitad),
      createdAt: corte.createdAt,
    },
    hoja,
  );

  return new NextResponse(pdf as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="hoja-de-corte-${corte.numero}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
