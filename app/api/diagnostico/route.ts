import { NextResponse } from "next/server";
import { ipDelPedido, permitido } from "@/lib/limites";
import { leerReporte, lineaDelNavegador } from "@/lib/diagnostico/registro";

/**
 * Donde el navegador avisa de un error de hidratación (ver
 * `instrumentation-client.ts`). Solo lo anota en el registro: no guarda nada
 * en la base ni le contesta nada útil a nadie.
 *
 * Es público —el error lo puede ver cualquiera que visite el sitio—, así que
 * se cuida como cualquier entrada de afuera: un tope de tamaño, solo pasan los
 * mensajes de hidratación (`leerReporte`) y un límite por IP, para que no se
 * pueda usar para llenar el registro.
 */
export async function POST(request: Request) {
  const crudo = await request.text();
  if (crudo.length > 4000) return new NextResponse(null, { status: 413 });

  let cuerpo: unknown;
  try {
    cuerpo = JSON.parse(crudo);
  } catch {
    return new NextResponse(null, { status: 400 });
  }

  const reporte = leerReporte(cuerpo);
  if (!reporte) return new NextResponse(null, { status: 400 });

  const veredicto = await permitido("diagnostico", await ipDelPedido());
  if (!veredicto.permitido) return new NextResponse(null, { status: 429 });

  console.error(lineaDelNavegador(reporte));
  return new NextResponse(null, { status: 204 });
}
