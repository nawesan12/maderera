"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";

/**
 * «Volver al pedido», cuando la firma se abrió desde el panel (`?volver=`).
 *
 * Va en la pizarra recién firmada y en la constancia: al firmar, la página se
 * vuelve a armar en el servidor por la rama firmada y la pizarra, que era la
 * que tenía el enlace, desaparecía (mes simulado, H225). Solo una ruta del
 * panel, nunca una dirección de afuera.
 */
export function VolverAlPedido() {
  const volver = useSearchParams().get("volver");
  const volverA = volver && /^\/admin\/pedidos\/[0-9a-f-]{36}$/.test(volver) ? volver : null;
  if (!volverA) return null;
  return (
    <Link
      href={volverA}
      className="boton-accion mt-5 inline-flex h-12 w-full items-center justify-center gap-2 rounded-lg text-base font-medium"
    >
      <ArrowLeft className="h-5 w-5" aria-hidden="true" />
      Volver al pedido
    </Link>
  );
}
