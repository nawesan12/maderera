import { requireStaff } from "@/lib/dal/session";
import { listarPrecios } from "@/lib/dal/admin/precios";
import { generarCsv } from "@/lib/precios-csv";

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
