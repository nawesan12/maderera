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
  discreto = false,
}: {
  orderId: string;
  comprobante: { id: string; numero: number; tipo: string } | null;
  /** La venta salió con comprobante interno a propósito: facturar no es lo que falta. */
  discreto?: boolean;
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
          className={`inline-flex h-10 items-center gap-1.5 rounded-lg px-3 text-base font-medium transition-colors disabled:opacity-60 ${
            discreto ? "text-muted-foreground hover:bg-hundida hover:text-foreground" : "border hover:bg-muted"
          }`}
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
          className="mt-2 flex items-start gap-2 text-base text-saldo-debe"
        >
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
          {estado.error}
        </p>
      )}
    </div>
  );
}
