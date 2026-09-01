"use client";

import { useActionState } from "react";
import Link from "next/link";
import { AlertCircle, FileText, Loader2, ReceiptText } from "lucide-react";
import { facturarPedido, type EstadoFactura } from "@/app/admin/facturacion/actions";

const inicial: EstadoFactura = {};

/**
 * Facturar el pedido.
 *
 * Si ya tiene comprobante, muestra el enlace en vez del botón: emitir dos
 * facturas del mismo pedido obliga a anular una con nota de crédito.
 */
export function BotonFacturar({
  orderId,
  comprobante,
}: {
  orderId: string;
  comprobante: { id: string; numero: number; tipo: string } | null;
}) {
  const [estado, accion, pendiente] = useActionState(facturarPedido, inicial);

  if (comprobante) {
    return (
      <Link
        href={`/admin/facturacion/${comprobante.id}`}
        className="inline-flex h-10 items-center gap-1.5 rounded-lg border px-3 text-base font-medium transition-colors hover:bg-muted"
      >
        <ReceiptText className="h-5 w-5" />
        Ver comprobante
      </Link>
    );
  }

  return (
    <div>
      <form action={accion}>
        <input type="hidden" name="orderId" value={orderId} />
        <button
          type="submit"
          disabled={pendiente}
          className="inline-flex h-10 items-center gap-1.5 rounded-lg border px-3 text-base font-medium transition-colors hover:bg-muted disabled:opacity-60"
        >
          {pendiente ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : (
            <FileText className="h-5 w-5" />
          )}
          Facturar
        </button>
      </form>

      {estado.error && (
        <p
          role="alert"
          className="mt-2 flex items-start gap-2 text-base text-red-700"
        >
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
          {estado.error}
        </p>
      )}
    </div>
  );
}
