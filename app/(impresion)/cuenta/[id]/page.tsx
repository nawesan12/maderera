import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getSession } from "@/lib/dal/session";
import { clienteDeLaSesion } from "@/lib/dal/cuenta";
import { resumenDeCuenta } from "@/lib/dal/admin/resumen-cuenta";
import { obtenerConfiguracionFiscal } from "@/lib/fiscal/emitir";
import { ResumenImpreso } from "@/components/cuenta/resumen-impreso";

export const metadata: Metadata = {
  title: "Resumen de cuenta",
  robots: { index: false, follow: false },
};

/**
 * El resumen de cuenta corriente, listo para imprimir o mandar en PDF.
 *
 * Misma regla de acceso que el remito y el comprobante: el personal ve
 * cualquiera y el cliente únicamente el suyo. La comparación contra el dueño va
 * antes de mostrar nada, y el identificador de la URL no autoriza por sí solo.
 */
export default async function ResumenDeCuentaPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const sesion = await getSession();

  if (!sesion) notFound();

  if (sesion.role !== "staff") {
    const cliente = await clienteDeLaSesion();
    if (!cliente || cliente.id !== id) notFound();
  }

  const [resumen, emisor] = await Promise.all([
    resumenDeCuenta(id),
    obtenerConfiguracionFiscal(),
  ]);

  if (!resumen) notFound();

  return <ResumenImpreso resumen={resumen} emisor={emisor} />;
}
