import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/dal/session";
import { obtenerCorte } from "@/lib/dal/admin/cortes";
import { calcularPlanoDeCorteSinTrabar, leerAcomodoManual } from "@/lib/cortes/plano";
import { nombreDeLaMitad } from "@/lib/cortes/placa";
import { armarHojaDeCorte } from "@/lib/cortes/secuencia";
import { hojaDeCortePdf } from "@/lib/pdf/hoja-de-corte";

/**
 * La hoja de corte para la seccionadora, en PDF.
 *
 * Personal con sesión, como el reporte: el despiece de un cliente no se publica
 * en una dirección adivinable. El plano se rehace con el disco y el motor del
 * trabajo, igual que en la ficha.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  await requireStaff();

  const { id } = await params;
  const corte = await obtenerCorte(id);
  if (!corte) return new NextResponse("No encontrado", { status: 404 });

  const plano = await calcularPlanoDeCorteSinTrabar({
    piezas: corte.piezas,
    placaLargo: corte.medida.largo,
    placaAncho: corte.medida.ancho,
    anchoSierra: corte.anchoSierraMm,
    fijadas: leerAcomodoManual(corte.acomodoManual),
    busqueda: corte.motorPlano >= 2,
  });

  const pdf = await hojaDeCortePdf(
    {
      numero: corte.numero,
      cliente: corte.cliente,
      material: corte.material,
      deQueSale: nombreDeLaMitad(corte.medida.mitad),
      createdAt: corte.createdAt,
    },
    armarHojaDeCorte(plano),
  );

  return new NextResponse(pdf as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="hoja-de-corte-${corte.numero}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
