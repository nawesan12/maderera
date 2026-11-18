"use client";

import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { CobroMultimedio } from "@/components/cobros/cobro-multimedio";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatearMonto } from "@/lib/formato";
import {
  cobrarCuentaEnMostrador,
  saldoDeCuenta,
  type EstadoCobroDeCuenta,
} from "./actions";
import { enfocar } from "./atajos";
import type { Cliente } from "./tipos";

/**
 * Lo que debe el cliente elegido, y cobrárselo ahí mismo.
 *
 * El cliente que viene a pagar su cuenta no viene a comprar: hasta acá había
 * que mandarlo a esperar a que alguien abriera la ficha en el panel. Con el
 * cliente elegido aparece lo que debe y el cobro con su recibo (`Alt + R`).
 */
export function SaldoDelCliente({
  cliente,
  branchId,
  enLinea,
}: {
  cliente: Cliente;
  branchId: string;
  enLinea: boolean;
}) {
  const [saldo, setSaldo] = useState<{ de: string; monto: number } | null>(null);
  const [abierto, setAbierto] = useState(false);

  useEffect(() => {
    if (!enLinea) return;
    let vigente = true;
    saldoDeCuenta(cliente.id).then((monto) => {
      if (vigente) setSaldo({ de: cliente.id, monto });
    });
    return () => {
      vigente = false;
    };
  }, [cliente.id, enLinea, abierto]);

  // El saldo es del cliente que se pidió: si se cambió en el medio, no se muestra.
  const monto = saldo?.de === cliente.id ? saldo.monto : null;
  if (monto === null || Math.abs(monto) < 0.01) return null;

  if (monto < 0) {
    return (
      <p className="px-1 text-sm text-muted-foreground">
        Tiene <strong className="tabular text-saldo-favor">{formatearMonto(-monto)}</strong> a
        favor: se usa cobrando con «Cuenta corriente».
      </p>
    );
  }

  return (
    <div className="flex items-center justify-between gap-3 px-1">
      <p className="text-sm">
        Debe <strong className="tabular text-saldo-debe">{formatearMonto(monto)}</strong>
      </p>
      <button
        type="button"
        data-foco="recibo"
        onClick={() => setAbierto(true)}
        className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-linea px-3 text-sm font-medium transition-colors hover:bg-hundida"
      >
        Cobrar su cuenta
        <kbd className="rounded border border-linea px-1 text-xs text-muted-foreground">Alt + R</kbd>
      </button>
      {abierto && (
        <CobroDeCuenta
          cliente={cliente}
          branchId={branchId}
          debe={monto}
          onCerrar={() => {
            setAbierto(false);
            enfocar("buscador");
          }}
        />
      )}
    </div>
  );
}

export function CobroDeCuenta({
  cliente,
  branchId,
  debe,
  onCerrar,
}: {
  cliente: Cliente;
  branchId: string;
  debe: number;
  onCerrar: () => void;
}) {
  const [estado, accion, pendiente] = useActionState(
    async (previo: EstadoCobroDeCuenta, formData: FormData) => {
      const r = await cobrarCuentaEnMostrador(previo, formData);
      if (r.ok && r.receiptId) {
        toast.success(r.ok);
        // El recibo se imprime en el acto: el cliente está esperando el papel.
        window.open(`/api/recibos/${r.receiptId}/pdf`, "_blank");
        onCerrar();
      }
      return r;
    },
    {} as EstadoCobroDeCuenta,
  );

  return (
    <Dialog open onOpenChange={(v) => !v && onCerrar()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold tracking-tight">
            Cobro de cuenta — {cliente.nombre}
          </DialogTitle>
        </DialogHeader>
        <p className="text-base text-muted-foreground">
          Debe <strong className="tabular text-foreground">{formatearMonto(debe)}</strong>. Si paga
          una parte, cargá solo lo que paga.
        </p>
        <form
          action={accion}
          onKeyDown={(e) => {
            // Enter avanza de campo en campo; en el último, cobra.
            if (e.key !== "Enter" || e.target instanceof HTMLButtonElement) return;
            const campos = Array.from(
              e.currentTarget.querySelectorAll<HTMLElement>("input:not([type=hidden]), select"),
            );
            const i = campos.indexOf(e.target as HTMLElement);
            if (i < 0) return;
            e.preventDefault();
            if (i < campos.length - 1) campos[i + 1]!.focus();
            else e.currentTarget.requestSubmit();
          }}
          className="space-y-4"
        >
          <input type="hidden" name="customerId" value={cliente.id} />
          <input type="hidden" name="branchId" value={branchId} />
          <CobroMultimedio aCobrar={debe} />
          {estado.error && (
            <p role="alert" className="estado-problema rounded-lg bg-[var(--estado-fondo)] px-3.5 py-2.5 text-base">
              {estado.error}
            </p>
          )}
          <button
            type="submit"
            disabled={pendiente}
            className="boton-accion inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl text-base font-semibold disabled:opacity-60"
          >
            {pendiente && <Loader2 className="h-5 w-5 animate-spin" />}
            Cobrar e imprimir el recibo
          </button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
