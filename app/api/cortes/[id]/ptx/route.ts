import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/dal/session";
import { obtenerCorte } from "@/lib/dal/admin/cortes";
import { calcularPlanoDeCorteSinTrabar, leerAcomodoManual } from "@/lib/cortes/plano";
import { armarHojaDeCorte } from "@/lib/cortes/secuencia";
import { armarPtx, nombreDeArchivoPtx } from "@/lib/cortes/ptx";

/**
 * El programa de corte del trabajo en PTX, para probar en la seccionadora.
 *
 * Experimental: no se sabe todavía si el WinCut del taller lo lee (ver
 * `lib/cortes/ptx.ts` y `docs/PTX.md`). Se lleva por pendrive —la PC de la
 * máquina no tiene internet— y el operario mira el dibujo en la pantalla de
 * WinCut antes de cortar.
 *
 * Personal con sesión, como el resto de los papeles del corte. Sale del mismo
 * plano que la hoja de corte, con el disco y el motor con que nació el trabajo.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  await requireStaff();

  const { id } = await params;
  const corte = await obtenerCorte(id);
  if (!corte) return new NextResponse("No encontrado", { status: 404 });

  if (corte.piezas.length === 0) {
    return new NextResponse("El corte no tiene piezas cargadas.", { status: 409 });
  }

  const plano = await calcularPlanoDeCorteSinTrabar({
    piezas: corte.piezas,
    placaLargo: corte.medida.largo,
    placaAncho: corte.medida.ancho,
    anchoSierra: corte.anchoSierraMm,
    fijadas: leerAcomodoManual(corte.acomodoManual),
    busqueda: corte.motorPlano >= 2,
  });

  if (plano.placas.length === 0) {
    return new NextResponse(
      "Ninguna pieza entra en la placa: no hay programa que armar. Revisá el despiece.",
      { status: 409 },
    );
  }

  const archivo = armarPtx(
    {
      numero: corte.numero,
      cliente: corte.cliente,
      material: corte.material,
      createdAt: corte.createdAt,
      piezas: corte.piezas,
    },
    armarHojaDeCorte(plano),
  );

  return new NextResponse(archivo, {
    headers: {
      // ASCII puro: no hace falta declarar otra codificación, y Windows XP lo
      // abre igual en el Bloc de notas.
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="${nombreDeArchivoPtx(corte.numero)}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
