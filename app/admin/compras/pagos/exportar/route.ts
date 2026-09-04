import { NextResponse, type NextRequest } from "next/server";
import { requireStaffRole } from "@/lib/dal/session";
import { retencionesDelPeriodo } from "@/lib/dal/admin/pagos-proveedor";
import { leerPeriodoMensual } from "@/lib/periodos";
import {
  armarCsv,
  cabecerasCsv,
  fechaCsv,
  numeroCsv,
  textoCsv,
} from "@/lib/csv-excel";

/**
 * Las retenciones practicadas del mes, en CSV.
 *
 * **CSV plano y no el layout SICORE**, a propósito y por ahora: SICORE es un
 * archivo de ancho fijo y no se puede dar por bueno sin verificarlo contra el
 * aplicativo real. Un archivo que el aplicativo rechaza es peor que no tener
 * archivo, porque se descubre el día del vencimiento. Con esto el contador
 * carga los datos y sabe que están bien.
 */
export async function GET(request: NextRequest) {
  await requireStaffRole("admin");

  const periodo = leerPeriodoMensual(
    request.nextUrl.searchParams.get("periodo"),
    new Date(),
  );

  const filas = await retencionesDelPeriodo(periodo.desde, periodo.hasta);

  const total = filas.reduce((s, f) => s + Number(f.importe), 0);

  const csv = armarCsv(
    [
      "Fecha",
      "Certificado",
      "Impuesto",
      "Régimen",
      "Proveedor",
      "CUIT",
      "Base",
      "Alícuota",
      "Retenido",
    ],
    filas.map((f) => [
      fechaCsv(f.fecha),
      textoCsv(f.numero),
      textoCsv(f.impuesto),
      textoCsv(f.codigoRegimen),
      textoCsv(f.proveedor),
      textoCsv(f.cuit),
      numeroCsv(Number(f.base)),
      numeroCsv(Number(f.alicuota), 3),
      numeroCsv(Number(f.importe)),
    ]),
    [
      textoCsv("Total"),
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      numeroCsv(total),
    ],
  );

  return new NextResponse(csv, {
    headers: cabecerasCsv(`retenciones-practicadas-${periodo.clave}.csv`),
  });
}
