import { NextResponse } from "next/server";
import { requireStaffRole } from "@/lib/dal/session";
import { certificadoParaImprimir } from "@/lib/dal/admin/pagos-proveedor";
import { configuracionFiscalActual } from "@/lib/dal/admin/facturacion";
import { certificadoDeRetencionPdf } from "@/lib/pdf/certificado-retencion";

/**
 * El certificado de retención en PDF.
 *
 * **No es un papel de cortesía:** es el comprobante con el que el proveedor se
 * computa la retención en su propia declaración. Sin él, le retuvimos plata que
 * no puede recuperar, y el reclamo llega igual pero un mes después.
 *
 * La dirección lleva el número y no el id porque es lo que está impreso: quien
 * tiene el papel en la mano puede reimprimirlo sin buscar nada.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ numero: string }> },
) {
  await requireStaffRole("admin");

  const { numero } = await params;
  const fila = await certificadoParaImprimir(decodeURIComponent(numero));

  if (!fila) {
    return new NextResponse("No existe ese certificado.", { status: 404 });
  }

  const emisor = await configuracionFiscalActual();

  const pdf = await certificadoDeRetencionPdf({
    numero: fila.numero,
    fecha: fila.fecha,
    impuesto: fila.impuesto,
    codigoRegimen: fila.codigoRegimen,
    nombreRegimen: fila.nombreRegimen ?? "",
    base: Number(fila.base),
    alicuota: Number(fila.alicuota),
    importe: Number(fila.importe),
    emisor,
    proveedor: {
      nombre: fila.proveedorNombre,
      razonSocial: fila.proveedorRazonSocial,
      cuit: fila.proveedorCuit,
      domicilio: fila.proveedorDomicilio,
    },
    pago: {
      fecha: fila.pagoFecha,
      medio: fila.pagoMedio,
      referencia: fila.pagoReferencia,
    },
  });

  return new NextResponse(pdf as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="retencion-${fila.numero}.pdf"`,
      // Depende de quién pregunta y no se guarda en ningún intermediario.
      "Cache-Control": "private, no-store",
    },
  });
}
