"use client";

import { startTransition, useActionState, useState } from "react";
import Link from "next/link";
import { AlertCircle, FileText, Loader2, ReceiptText } from "lucide-react";
import { facturarPedido, type EstadoFactura } from "@/app/admin/facturacion/actions";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatearCuit, formatearMonto } from "@/lib/formato";

const inicial: EstadoFactura = {};

/** Lo que se va a emitir, para confirmarlo antes (la letra, a quién y cuánto). */
export interface FacturaPorEmitir {
  letra: string;
  receptor: string;
  cuit: string | null;
  condicion: string | null;
  total: number;
}

const CONDICION: Record<string, string> = {
  responsable_inscripto: "Responsable inscripto",
  monotributista: "Monotributista",
  exento: "Exento",
  consumidor_final: "Consumidor final",
};

/**
 * Facturar el pedido.
 *
 * Si ya tiene comprobante, muestra el enlace en vez del botón: emitir dos
 * facturas del mismo pedido obliga a anular una con nota de crédito.
 *
 * Antes de emitir confirma la letra, el receptor y el total, como la
 * factura manual (mes simulado 2: un toque emitía y mandaba el PDF; con el
 * certificado, ese toque pide un CAE que no tiene vuelta).
 */
export function BotonFacturar({
  orderId,
  comprobante,
  discreto = false,
  porEmitir = null,
}: {
  orderId: string;
  comprobante: { id: string; numero: number; tipo: string } | null;
  /** La venta salió con comprobante interno a propósito: facturar no es lo que falta. */
  discreto?: boolean;
  porEmitir?: FacturaPorEmitir | null;
}) {
  const [estado, accion, pendiente] = useActionState(facturarPedido, inicial);
  const [abierto, setAbierto] = useState(false);

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

  function emitir() {
    const datos = new FormData();
    datos.set("orderId", orderId);
    startTransition(() => accion(datos));
  }

  return (
    <div>
      <button
        type="button"
        disabled={pendiente}
        onClick={() => setAbierto(true)}
        className={`inline-flex h-10 items-center gap-1.5 rounded-lg px-3 text-base font-medium transition-colors disabled:opacity-60 ${
          discreto ? "text-muted-foreground hover:bg-hundida hover:text-foreground" : "border hover:bg-muted"
        }`}
      >
        {pendiente ? <Loader2 className="h-5 w-5 animate-spin" /> : <FileText className="h-5 w-5" />}
        Facturar
      </button>

      <Dialog open={abierto} onOpenChange={(v) => !pendiente && setAbierto(v)}>
        <DialogContent className="sm:max-w-md" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>
              {porEmitir ? (
                <>
                  Factura {porEmitir.letra} por <span className="tabular whitespace-nowrap">{formatearMonto(porEmitir.total)}</span>
                </>
              ) : (
                "Facturar el pedido"
              )}
            </DialogTitle>
          </DialogHeader>
          {porEmitir && (
            <div className="rounded-lg bg-hundida px-4 py-3 text-base">
              <p className="font-medium">{porEmitir.receptor}</p>
              <p className="text-sm text-muted-foreground">
                {porEmitir.cuit ? `CUIT ${formatearCuit(porEmitir.cuit)}` : "Sin CUIT"}
                {porEmitir.condicion && ` · ${CONDICION[porEmitir.condicion] ?? porEmitir.condicion}`}
              </p>
            </div>
          )}
          {estado.error && (
            <p role="alert" className="flex items-start gap-2 text-base text-saldo-debe">
              <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
              {estado.error}
            </p>
          )}
          <div className="flex justify-end pt-2">
            <button
              type="button"
              autoFocus
              disabled={pendiente}
              onClick={emitir}
              className="boton-accion inline-flex h-11 items-center gap-2 rounded-lg px-4 text-base font-medium disabled:opacity-50"
            >
              {pendiente && <Loader2 className="h-4 w-4 animate-spin" />}
              Emitir
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
