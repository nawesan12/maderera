import { NextResponse } from "next/server";
import { listarCortes } from "@/lib/dal/admin/cortes";
import { agenteAutorizado, tokenDelAgente } from "@/lib/cortes/agente";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Los cortes que el agente del taller tiene que bajar.
 *
 * Es el "nivel 2" de la integración con la seccionadora: en vez de que alguien
 * baje el archivo y lo copie a mano, un agente que corre en la PC del taller
 * pregunta acá cada tanto y deja los archivos en la carpeta que el optimizador
 * vigila.
 *
 * **Solo lectura.** El agente no marca nada como exportado del lado del
 * servidor: lleva su propio registro de qué ya escribió. Es la decisión
 * conservadora a propósito — si el agente se cuelga, se reinstala o se corre en
 * dos máquinas, lo peor que pasa es que vuelva a escribir un archivo, no que
 * deje un corte marcado como enviado que nunca llegó.
 *
 * Devuelve `actualizado` para que el agente distinga "ya lo bajé" de "lo bajé
 * pero después le cambiaron las piezas".
 */
export async function GET(request: Request) {
  // Sin token configurado la integración no existe. Ver `lib/cortes/agente.ts`.
  if (!tokenDelAgente()) {
    return new NextResponse("No encontrado", { status: 404 });
  }

  if (!agenteAutorizado(request)) {
    return new NextResponse("No autorizado", { status: 401 });
  }

  const cortes = await listarCortes(
    { estado: "en-cola" },
    "agente-del-taller",
  );

  return NextResponse.json({
    cortes: cortes
      .filter((c) => c.piezas > 0)
      .map((c) => ({
        id: c.id,
        numero: c.numero,
        cliente: c.cliente,
        material: c.material,
        piezas: c.piezas,
        urgente: c.urgente,
        actualizado: c.createdAt.toISOString(),
      })),
  });
}
