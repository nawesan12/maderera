import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getSession } from "@/lib/dal/session";
import { clienteDeLaSesion } from "@/lib/dal/cuenta";
import { remitoCompleto } from "@/lib/dal/admin/entregas";
import { obtenerConfiguracionFiscal } from "@/lib/fiscal/emitir";
import { RemitoImpreso } from "@/components/entregas/remito-impreso";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

/**
 * El remito listo para imprimir.
 *
 * Misma regla que el comprobante fiscal: el personal ve cualquiera y el cliente
 * únicamente los suyos. La verificación va acá, con la comparación contra el
 * dueño hecha antes de mostrar nada.
 */
export default async function ImprimirRemitoPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const sesion = await getSession();

  if (!sesion) notFound();

  const [remito, emisor] = await Promise.all([
    remitoCompleto(id),
    obtenerConfiguracionFiscal(),
  ]);

  if (!remito) notFound();

  if (sesion.role !== "staff") {
    const cliente = await clienteDeLaSesion();
    if (!cliente || remito.customerId !== cliente.id) notFound();
  }

  return <RemitoImpreso remito={remito} emisor={emisor} />;
}
