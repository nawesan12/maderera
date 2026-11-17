import type { Metadata } from "next";
import { puedeEntrar } from "@/lib/roles";
import { notFound } from "next/navigation";
import { Hoja, MUESTRA_DEL_BUILD } from "../../preparando";
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
export async function generateStaticParams() {
  return MUESTRA_DEL_BUILD;
}

export default function ResumenDeCuentaPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return (
    <Hoja que="cliente" params={params}>
      <Contenido params={params} />
    </Hoja>
  );
}

async function Contenido({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const sesion = await getSession();

  if (!sesion) notFound();

  // Del personal, quien entra a las fichas de clientes, como pide Go: la
  // lectura va con el secreto interno, así que si no se mira acá el depósito
  // y el aserradero veían la cuenta corriente de cualquiera.
  if (sesion.role === "staff") {
    if (!puedeEntrar("/admin/clientes", sesion.staffRole)) notFound();
  } else {
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
