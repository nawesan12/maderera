import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/dal/session";
import { obtenerCorte } from "@/lib/dal/admin/cortes";
import { obtenerConfiguracionFiscal } from "@/lib/fiscal/emitir";
import { calcularPlanoDeCorteSinTrabar, leerAcomodoManual } from "@/lib/cortes/plano";
import { nombreDeLaMitad } from "@/lib/cortes/placa";
import { metrosDeTapacanto } from "@/lib/cortes/tarifa";
import { cortePdf } from "@/lib/pdf/corte";

/**
 * El reporte del trabajo de corte, en PDF.
 *
 * Es de taller y de mostrador, así que exige sesión de personal: el despiece de
 * un cliente dice qué está construyendo y con cuánto material, y eso no se
 * publica en una dirección adivinable.
 *
 * El plano se recalcula acá y no se guarda: es geometría pura sobre el despiece
 * y la medida de la placa, así que siempre da lo mismo. Guardarlo sería tener
 * dos verdades cuando alguien corrige una medida.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  await requireStaff();

  const { id } = await params;
  const [corte, emisor] = await Promise.all([obtenerCorte(id), obtenerConfiguracionFiscal()]);

  if (!corte) return new NextResponse("No encontrado", { status: 404 });

  const plano = await calcularPlanoDeCorteSinTrabar({
    piezas: corte.piezas,
    placaLargo: corte.medida.largo,
    placaAncho: corte.medida.ancho,
    // El disco del trabajo, no el general de hoy.
    anchoSierra: corte.anchoSierraMm,
    fijadas: leerAcomodoManual(corte.acomodoManual),
  });

  const pdf = await cortePdf(
    {
      numero: corte.numero,
      cliente: corte.cliente,
      material: corte.material,
      cantoDescripcion: corte.cantoDescripcion,
      deQueSale: nombreDeLaMitad(corte.medida.mitad),
      createdAt: corte.createdAt,
      metrosCanto: metrosDeTapacanto(corte.piezas),
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
