"use client";

import { useActionState, useState, useTransition } from "react";
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
import {
  cobrarPedido,
  registrarCobroDeCliente,
  type EstadoCobro,
} from "@/app/admin/cobros-actions";
import { abrirCaja } from "@/app/mostrador/actions";

/**
 * «Registrar cobro»: lo que pagó un cliente, con su recibo.
 *
 * Abre desde la ficha del cliente (pago a cuenta) y desde un pedido. Con
 * `pedido` cobra el pedido (POST /admin/pedidos/{id}/cobro): tenga o no
 * cliente, con recibo, y el efectivo al turno de su sucursal. Al terminar
 * ofrece el recibo para imprimir en el mismo aviso: el cliente suele estar
 * enfrente esperando el papel.
 *
 * Cada vez que se abre nace una clave nueva (T3, hallazgo 14): si la
 * respuesta se pierde y se aprieta otra vez, Go devuelve el mismo recibo en
 * vez de cobrar dos veces.
 */
export function DialogoCobro({
  customerId,
  nombre,
  aCobrar,
  orderId,
  numeroPedido,
  pedido,
  etiqueta = "Registrar cobro",
  claseBoton,
  alCobrar,
  abierto: abiertoAfuera,
  alCambiarAbierto,
  sinBoton = false,
}: {
  customerId?: string | null;
  nombre: string;
  /** Lo que se propone cobrar: la deuda, o el saldo del pedido. */
  aCobrar: number;
  /** Cobro desde la cuenta del cliente, atado a un pedido. */
  orderId?: string;
  numeroPedido?: string;
  /** El cobro del pedido mismo, desde su ficha o el tablero. */
  pedido?: { id: string; numero: string };
  etiqueta?: string;
  claseBoton?: string;
  /** Después de un cobro que salió bien (entregar, cerrar el alta del cheque). */
  alCobrar?: () => void;
  /** Abierto desde afuera («Cobrar y entregar»). */
  abierto?: boolean;
  alCambiarAbierto?: (abierto: boolean) => void;
  sinBoton?: boolean;
}) {
  const router = useRouter();
  const [abiertoAdentro, setAbiertoAdentro] = useState(false);
  const abierto = abiertoAfuera ?? abiertoAdentro;
  const [clave, setClave] = useState(() => crypto.randomUUID());
  const [fondo, setFondo] = useState("");
  const [abriendo, empezarAApertura] = useTransition();

  function cambiar(a: boolean) {
    if (a) setClave(crypto.randomUUID());
    setAbiertoAdentro(a);
    alCambiarAbierto?.(a);
  }

  const [estado, accion, pendiente] = useActionState(
    async (previo: EstadoCobro, formData: FormData) => {
      const r = pedido ? await cobrarPedido(previo, formData) : await registrarCobroDeCliente(previo, formData);
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
        cambiar(false);
        alCobrar?.();
        router.refresh();
      }
      return r;
    },
    {} as EstadoCobro,
  );

  /** Sin caja abierta no se cobra en efectivo: se abre ahí mismo y se sigue. */
  function abrirLaCaja() {
    const sucursal = estado.sinCaja;
    if (!sucursal) return;
    empezarAApertura(async () => {
      const r = await abrirCaja(sucursal, Number(fondo.replace(",", ".")) || 0);
      if (r.error) {
        toast.error(r.error);
        return;
      }
      toast.success(r.ok ?? "Caja abierta.");
    });
  }

  const titulo = pedido
    ? `Cobrar ${pedido.numero}`
    : numeroPedido
      ? `Cobro del pedido ${numeroPedido}`
      : `Cobro — ${nombre}`;

  return (
    <Dialog open={abierto} onOpenChange={cambiar}>
      {!sinBoton && (
        <DialogTrigger
          className={
            claseBoton ??
            "boton-accion inline-flex h-10 items-center justify-center gap-1.5 rounded-lg px-3 text-base font-medium"
          }
        >
          <Wallet className="h-5 w-5" />
          {etiqueta}
        </DialogTrigger>
      )}
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>
            {titulo}
            {aCobrar > 0 && (
              <>
                {" · "}
                <span className="tabular">{formatearMonto(aCobrar)}</span>
              </>
            )}
          </DialogTitle>
        </DialogHeader>

        <form action={accion} className="space-y-4">
          <input type="hidden" name="clave" value={clave} />
          {customerId && <input type="hidden" name="customerId" value={customerId} />}
          {pedido && <input type="hidden" name="pedidoId" value={pedido.id} />}
          {orderId && <input type="hidden" name="orderId" value={orderId} />}

          <CobroMultimedio aCobrar={Math.max(aCobrar, 0)} />

          {!orderId && !pedido && (
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

          {estado.sinCaja && (
            <div className="tarjeta-hundida flex flex-wrap items-end gap-2.5 rounded-xl p-3">
              <label className="min-w-40 flex-1 text-sm text-muted-foreground">
                Fondo inicial
                <input
                  inputMode="decimal"
                  value={fondo}
                  onChange={(e) => setFondo(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      abrirLaCaja();
                    }
                  }}
                  autoFocus
                  className="tabular mt-1 block h-11 w-full rounded-lg border border-linea bg-background px-3 text-base text-foreground"
                />
              </label>
              <button
                type="button"
                onClick={abrirLaCaja}
                disabled={abriendo}
                className="inline-flex h-11 items-center gap-2 rounded-lg border px-4 text-base font-medium hover:bg-muted disabled:opacity-50"
              >
                {abriendo && <Loader2 className="h-4 w-4 animate-spin" />}
                Abrir caja
              </button>
            </div>
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
