import { requireStaff } from "@/lib/dal/session";
import { listarPrecios } from "@/lib/dal/admin/precios";
import { generarCsv } from "@/lib/precios-csv";
import { pdfDeListaDePrecios } from "@/lib/pdf/lista-precios";
import { obtenerConfiguracionFiscal } from "@/lib/fiscal/emitir";

/**
 * Descarga la lista de precios como planilla.
 *
 * Respeta los filtros que están puestos en pantalla: si alguien filtró por
 * Molduras, baja las molduras. Exportar siempre el catálogo entero obligaría a
 * borrar filas a mano antes de trabajar.
 */
export async function GET(request: Request) {
  await requireStaff();

  const { searchParams } = new URL(request.url);
  const filas = await listarPrecios({
    busqueda: searchParams.get("buscar") ?? undefined,
    categoria: searchParams.get("cat") ?? undefined,
  });

  /*
   * Dos formatos, dos usos distintos.
   *
   * El CSV es para trabajar la planilla y volver a subirla. El PDF es lo que
   * se le manda a un cliente que pide la lista —el brief lo pone entre la
   * documentación descargable para profesionales— y por eso lleva membrete,
   * fecha de vigencia y el precio de la lista que se pidió.
   */
  if (searchParams.get("formato") === "pdf") {
    const lista = searchParams.get("lista") === "profesional" ? "profesional" : "general";
    const emisor = await obtenerConfiguracionFiscal();

    const pdf = await pdfDeListaDePrecios({
      titulo: lista === "profesional" ? "Lista profesional" : "Lista de precios",
      emisor,
      leyendaIva: "Precios finales con IVA incluido",
      filas: filas.map((f) => ({
        sku: f.sku,
        producto: f.producto,
        medida: f.medida,
        categoria: f.categoria,
        precio: lista === "profesional" ? f.precioProfesional : f.precioGeneral,
      })),
    });

    return new Response(pdf as BodyInit, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="precios-mjbj-${new Date().toISOString().slice(0, 10)}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  }

  const csv = generarCsv(
    filas.map((f) => ({
      sku: f.sku,
      producto: f.producto,
      medida: f.medida,
      categoria: f.categoria,
      precioGeneral: f.precioGeneral,
      precioProfesional: f.precioProfesional,
    })),
  );

  const fecha = new Date().toISOString().slice(0, 10);

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="precios-mjbj-${fecha}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
