import { NextResponse, type NextRequest } from "next/server";
import { requireStaffRole } from "@/lib/dal/session";
import { libroIvaCompras } from "@/lib/dal/admin/compras-fiscal";
import { leerPeriodoMensual } from "@/lib/periodos";
import {
  daCreditoFiscal,
  nombreComprobanteCompra,
  numeroDeCompra,
} from "@/lib/fiscal/comprobantes-compra";
import {
  armarCsv,
  cabecerasCsv,
  fechaCsv,
  numeroCsv,
  textoCsv,
} from "@/lib/csv-excel";

/**
 * El libro IVA compras en CSV, que es como lo pide el contador.
 *
 * Lleva una columna que el de ventas no tiene: **si el comprobante da crédito
 * fiscal**. La B y la C no discriminan IVA y no se computan, y quien arma la
 * posición del mes necesita poder filtrar por eso sin conocer de memoria qué
 * letra da crédito.
 */
export async function GET(request: NextRequest) {
  await requireStaffRole("admin");

  const periodo = leerPeriodoMensual(
    request.nextUrl.searchParams.get("periodo"),
    new Date(),
  );

  const libro = await libroIvaCompras(periodo.desde, periodo.hasta);

  const filas = libro.filas.map((f) => [
    fechaCsv(f.fechaEmision),
    textoCsv(nombreComprobanteCompra(f.tipo)),
    textoCsv(numeroDeCompra(f.puntoVenta, f.numero)),
    textoCsv(f.proveedor),
    textoCsv(f.cuit),
    numeroCsv(f.neto),
    numeroCsv(f.iva21),
    numeroCsv(f.iva105),
    numeroCsv(f.iva27),
    numeroCsv(f.exento),
    numeroCsv(f.percepciones),
    numeroCsv(f.total),
    textoCsv(daCreditoFiscal(f.tipo) ? "Sí" : "No"),
    textoCsv(f.cae),
  ]);

  const computable = libro.filas
    .filter((f) => daCreditoFiscal(f.tipo))
    .reduce((s, f) => s + f.iva21 + f.iva105 + f.iva27, 0);

  const csv = armarCsv(
    [
      "Fecha",
      "Comprobante",
      "Número",
      "Proveedor",
      "CUIT",
      "Neto",
      "IVA 21%",
      "IVA 10,5%",
      "IVA 27%",
      "Exento",
      "Percepciones",
      "Total",
      "Da crédito fiscal",
      "CAE",
    ],
    filas,
    [
      textoCsv("Totales"),
      "",
      "",
      "",
      "",
      numeroCsv(libro.totales.neto),
      numeroCsv(libro.totales.iva21),
      numeroCsv(libro.totales.iva105),
      numeroCsv(libro.totales.iva27),
      numeroCsv(libro.totales.exento),
      numeroCsv(libro.totales.percepciones),
      numeroCsv(libro.totales.total),
      // El total de la columna es lo computable, no la suma de todo: sumar los
      // que no dan crédito es exactamente lo que este archivo evita.
      textoCsv(`Computable: ${numeroCsv(computable)}`),
      "",
    ],
  );

  return new NextResponse(csv, {
    headers: cabecerasCsv(`libro-iva-compras-${periodo.clave}.csv`),
  });
}
