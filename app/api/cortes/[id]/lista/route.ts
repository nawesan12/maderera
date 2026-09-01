import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/dal/session";
import { agenteAutorizado } from "@/lib/cortes/agente";
import { obtenerCorte } from "@/lib/dal/admin/cortes";
import { perfilParaExportar } from "@/lib/dal/admin/cortes-exportacion";
import { armarArchivoDeCorte, nombreDeArchivo } from "@/lib/cortes/formatos";

/**
 * La lista de piezas de un corte, en el formato que importa el optimizador.
 *
 * Es el "nivel 1" de la integración con la seccionadora: el operador la baja,
 * la copia a la PC de la máquina y la importa. No hace falta que la PC del
 * taller esté en red ni que tenga internet, y ya evita volver a tipear treinta
 * medidas que están cargadas acá.
 *
 * El nivel siguiente —un agente local que deje el archivo solo en la carpeta
 * que el optimizador vigila— consume exactamente esto, así que construirlo no
 * se tira cuando se avance.
 */
export const runtime = "nodejs";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  // Dos caminos de entrada: alguien del panel con su sesión, o el agente del
  // taller con su token. El agente no es un navegador y no tiene cookie.
  const porAgente = agenteAutorizado(request);
  if (!porAgente) await requireStaff();

  const autorizadoPor = porAgente ? ("agente-del-taller" as const) : undefined;

  const { id } = await params;
  const perfilId = new URL(request.url).searchParams.get("perfil") ?? undefined;

  const [corte, perfil] = await Promise.all([
    obtenerCorte(id, autorizadoPor),
    perfilParaExportar(perfilId, autorizadoPor),
  ]);

  if (!corte) return new NextResponse("No encontrado", { status: 404 });

  if (corte.piezas.length === 0) {
    return new NextResponse("El corte no tiene piezas cargadas.", {
      status: 409,
    });
  }

  const archivo = armarArchivoDeCorte(
    {
      numero: corte.numero,
      cliente: corte.cliente,
      material: corte.material,
      piezas: corte.piezas.map((p) => ({
        largoMm: p.largoMm,
        anchoMm: p.anchoMm,
        cantidad: p.cantidad,
        respetaVeta: p.respetaVeta,
        cantoLargo: p.cantoLargo,
        cantoAncho: p.cantoAncho,
        etiqueta: p.etiqueta,
      })),
    },
    perfil,
  );

  // BOM al principio: sin esto Excel abre el archivo en Windows y muestra
  // "Melamina blanca" con la acentuación rota, y el operador cree que el
  // sistema le mandó basura.
  const conBom = `﻿${archivo}`;

  return new NextResponse(conBom, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${nombreDeArchivo(corte.numero, perfil.separador)}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
