"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Wallet } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { CobroMultimedio } from "@/components/cobros/cobro-multimedio";
import { formatearMonto } from "@/lib/formato";
import { registrarCobroDeCliente, type EstadoCobro } from "@/app/admin/cobros-actions";

/**
 * «Registrar cobro»: lo que pagó un cliente, con su recibo.
 *
 * Abre desde la ficha del cliente (pago a cuenta) y desde un pedido a cuenta
 * corriente. Al terminar ofrece el recibo para imprimir en el mismo aviso: el
 * cliente suele estar enfrente esperando el papel.
 */
export function DialogoCobro({
  customerId,
  nombre,
  aCobrar,
  orderId,
  numeroPedido,
  etiqueta = "Registrar cobro",
  claseBoton,
}: {
  customerId: string;
  nombre: string;
  /** Lo que se propone cobrar: la deuda, o el total del pedido. */
  aCobrar: number;
  orderId?: string;
  numeroPedido?: string;
  etiqueta?: string;
  claseBoton?: string;
}) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);

  const [estado, accion, pendiente] = useActionState(
    async (previo: EstadoCobro, formData: FormData) => {
      const r = await registrarCobroDeCliente(previo, formData);
      if (r.ok) {
        toast.success(r.ok, {
          duration: 12_000,
          action: r.receiptId
            ? {
                label: "Imprimir recibo",
                onClick: () => window.open(`/api/recibos/${r.receiptId}/pdf`, "_blank"),
              }
            : undefined,
        });
        // Lo que hay que mirar —el efectivo que no entró a ninguna caja— va en
        // un aviso aparte y en amarillo: pegado al verde del éxito no se lee.
        if (r.aviso) toast.warning(r.aviso, { duration: 15_000 });
        setAbierto(false);
        router.refresh();
      }
      return r;
    },
    {} as EstadoCobro,
  );

  return (
    <Dialog open={abierto} onOpenChange={setAbierto}>
      <DialogTrigger
        className={
          claseBoton ??
          "boton-accion inline-flex h-10 items-center justify-center gap-1.5 rounded-lg px-3 text-base font-medium"
        }
      >
        <Wallet className="h-5 w-5" />
        {etiqueta}
      </DialogTrigger>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {numeroPedido ? `Cobro del pedido ${numeroPedido}` : `Cobro — ${nombre}`}
          </DialogTitle>
        </DialogHeader>

        {aCobrar > 0 && (
          <p className="text-base text-muted-foreground">
            {numeroPedido ? "El pedido es de " : "Debe "}
            <strong className="tabular text-foreground">{formatearMonto(aCobrar)}</strong>. Si
            paga una parte, cargá solo lo que paga: el resto queda en la cuenta.
          </p>
        )}

        <form action={accion} className="space-y-4">
          <input type="hidden" name="customerId" value={customerId} />
          {orderId && <input type="hidden" name="orderId" value={orderId} />}

          <CobroMultimedio aCobrar={Math.max(aCobrar, 0)} />

          {!orderId && (
            <label className="block text-sm text-muted-foreground">
              Concepto <span className="font-normal">(opcional)</span>
              <input
                name="concepto"
                placeholder="Pago a cuenta"
                className="mt-1 block h-11 w-full rounded-lg border border-linea bg-background px-3 text-base text-foreground"
              />
            </label>
          )}

          {estado.error && (
            <p role="alert" className="estado-problema text-base font-medium">
              {estado.error}
            </p>
          )}

          <button
            type="submit"
            disabled={pendiente}
            className="boton-accion inline-flex h-12 w-full items-center justify-center gap-2 rounded-lg text-base font-semibold disabled:opacity-60"
          >
            {pendiente && <Loader2 className="h-5 w-5 animate-spin" />}
            Registrar y emitir recibo
          </button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
