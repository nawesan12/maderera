import { NextResponse, type NextRequest } from "next/server";
import { requireStaffRole } from "@/lib/dal/session";
import { asientosDelPeriodo } from "@/lib/dal/admin/cierre-mensual";
import { leerPeriodoMensual } from "@/lib/periodos";
import { balancea } from "@/lib/contable/asientos";
import {
  armarCsv,
  cabecerasCsv,
  fechaCsv,
  numeroCsv,
  textoCsv,
} from "@/lib/csv-excel";

/**
 * Los asientos del mes, para que el estudio los importe.
 *
 * Un renglón por línea, con el número de asiento repetido: es el formato que
 * todos los sistemas contables saben leer, y el que permite reordenar en la
 * planilla sin perder a qué asiento pertenece cada renglón.
 *
 * Va **el código y el nombre** de cada cuenta. El código es una sugerencia —cada
 * estudio tiene su plan— y el nombre es lo que permite remapearlo sin adivinar.
 */
export async function GET(request: NextRequest) {
  await requireStaffRole("admin");

  const periodo = leerPeriodoMensual(
    request.nextUrl.searchParams.get("periodo"),
    new Date(),
  );

  const asientos = await asientosDelPeriodo(periodo.desde, periodo.hasta);

  const filas: string[][] = [];
  let totalDebe = 0;
  let totalHaber = 0;

  asientos.forEach((asiento, i) => {
    const numero = String(i + 1).padStart(5, "0");

    for (const r of asiento.renglones) {
      totalDebe += r.debe;
      totalHaber += r.haber;

      filas.push([
        textoCsv(numero),
        fechaCsv(asiento.fecha),
        textoCsv(asiento.concepto),
        textoCsv(r.cuenta),
        textoCsv(r.nombre),
        // Vacío y no cero: una planilla con ceros en las dos columnas es
        // ilegible, y el estudio filtra por celda vacía.
        r.debe === 0 ? "" : numeroCsv(r.debe),
        r.haber === 0 ? "" : numeroCsv(r.haber),
        // Que un asiento no cierre es un problema, y tiene que verse en el
        // archivo y no solo en la pantalla.
        textoCsv(balancea(asiento) ? "" : "NO CIERRA"),
      ]);
    }
  });

  const csv = armarCsv(
    [
      "Asiento",
      "Fecha",
      "Concepto",
      "Cuenta",
      "Nombre de cuenta",
      "Debe",
      "Haber",
      "Observación",
    ],
    filas,
    [
      textoCsv("Totales"),
      "",
      "",
      "",
      "",
      numeroCsv(totalDebe),
      numeroCsv(totalHaber),
      textoCsv(
        Math.abs(totalDebe - totalHaber) < 0.01 ? "" : "EL PERÍODO NO CIERRA",
      ),
    ],
  );

  return new NextResponse(csv, {
    headers: cabecerasCsv(`asientos-${periodo.clave}.csv`),
  });
}
