import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  comprobanteDelCliente,
  configuracionFiscalActual,
  obtenerComprobante,
} from "@/lib/dal/admin/facturacion";
import { getSession } from "@/lib/dal/session";
import { clienteDeLaSesion } from "@/lib/dal/cuenta";
import { obtenerConfiguracionFiscal } from "@/lib/fiscal/emitir";
import { ComprobanteImpreso } from "@/components/fiscal/comprobante-impreso";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

/**
 * El comprobante listo para imprimir.
 *
 * La misma hoja para las dos partes: el personal la abre desde el panel y el
 * cliente desde su portal. Quién puede ver qué se decide acá, y de una sola
 * manera: el personal ve cualquiera, y el cliente únicamente los suyos.
 */
export default async function ImprimirComprobantePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const sesion = await getSession();

  if (!sesion) notFound();

  if (sesion.role === "staff") {
    const [comprobante, emisor] = await Promise.all([
      obtenerComprobante(id),
      configuracionFiscalActual(),
    ]);

    if (!comprobante) notFound();
    return <ComprobanteImpreso comprobante={comprobante} emisor={emisor} />;
  }

  // Cliente: solo los propios. El filtro por dueño va dentro de la consulta.
  const cliente = await clienteDeLaSesion();
  if (!cliente) notFound();

  const [comprobante, emisor] = await Promise.all([
    comprobanteDelCliente(id, cliente.id),
    obtenerConfiguracionFiscal(),
  ]);

  if (!comprobante) notFound();

  return <ComprobanteImpreso comprobante={comprobante} emisor={emisor} />;
}
