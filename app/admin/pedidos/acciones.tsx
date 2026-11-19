"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowRight, Ban, Loader2 } from "lucide-react";
import { avanzarPedido, cancelarPedido } from "@/app/admin/ventas-actions";
import { DialogoCobro } from "@/components/cobros/dialogo-cobro";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { moneda } from "@/components/admin/formato";

const SIGUIENTE: Record<string, string> = {
  pendiente: "Preparar",
  preparando: "Marcar listo",
  listo: "Despachar",
  "en-camino": "Marcar entregado",
};

export function AccionesPedido({
  id,
  estado,
  estadoPago,
  tipoEntrega,
  compacto = false,
  cobro,
  sinCobrar,
}: {
  id: string;
  estado: string;
  estadoPago: string;
  tipoEntrega: string;
  /** En una tarjeta de tablero los botones ocupan el ancho disponible. */
  compacto?: boolean;
  /**
   * Para cobrar: con recibo, tenga o no cliente, y el efectivo a la caja de su
   * sucursal (cobros.CobrarPedido). Antes «Cobrar» marcaba el pedido pagado
   * sin recibo ni caja. Sin esto (el depósito, que no mueve plata), el botón
   * no aparece.
   */
  cobro?: { numero: string; aCobrar: number; customerId: string | null; nombre: string } | null;
  /**
   * Lo que falta cobrar fuera de la cuenta corriente (`sinCobrar` del
   * pedido, la misma regla que «Me deben»). Con algo, «Marcar entregado»
   * pregunta antes, en el tablero y en el reparto por igual: lo fuerte es
   * «Cobrar y entregar» (el pago contra entrega es lo normal), y entregar sin
   * cobrar queda al lado, sin bloquearse. El servidor deja la firma en el
   * historial igual.
   */
  sinCobrar?: { numero: string; monto: number } | null;
}) {
  const router = useRouter();
  const [pendiente, startTransition] = useTransition();
  const [confirmando, setConfirmando] = useState(false);
  // «Cobrar y entregar» abre el cobro y, cobrado, entrega.
  const [cobrandoParaEntregar, setCobrandoParaEntregar] = useState(false);

  // Un pedido de retiro no se despacha: el cliente lo busca.
  const etiqueta =
    estado === "listo" && tipoEntrega === "retiro"
      ? "Marcar entregado"
      : SIGUIENTE[estado];

  function accion(fn: () => Promise<{ ok?: string; error?: string }>) {
    startTransition(async () => {
      const resultado = await fn();
      if (resultado.error) toast.error(resultado.error);
      else {
        setConfirmando(false);
        toast.success(resultado.ok ?? "Listo.");
        router.refresh();
      }
    });
  }

  const preguntar = etiqueta === "Marcar entregado" && sinCobrar != null && sinCobrar.monto > 0;

  return (
    <div className={`flex items-center gap-2 ${compacto ? "w-full" : ""}`}>
      {estadoPago !== "pagado" && estado !== "cancelado" && cobro && cobro.aCobrar > 0 && (
        <DialogoCobro
          customerId={cobro.customerId}
          nombre={cobro.nombre}
          aCobrar={cobro.aCobrar}
          pedido={{ id, numero: cobro.numero }}
          etiqueta="Cobrar"
          claseBoton={`inline-flex h-10 items-center justify-center gap-1.5 rounded-lg border px-3 text-base font-medium transition-colors hover:bg-muted ${compacto ? "min-w-0 flex-1 basis-0" : ""}`}
        />
      )}

      {etiqueta && (
        <button
          onClick={() => (preguntar ? setConfirmando(true) : accion(() => avanzarPedido(id)))}
          disabled={pendiente}
          className={`inline-flex h-10 items-center justify-center gap-1.5 rounded-lg boton-accion px-3 text-base font-medium transition-colors disabled:opacity-50 ${compacto ? "min-w-0 flex-1 basis-0" : ""}`}
        >
          {pendiente ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : (
            <ArrowRight className="h-5 w-5" />
          )}
          {etiqueta}
        </button>
      )}

      {preguntar && sinCobrar && (
        <Dialog open={confirmando} onOpenChange={(abierto) => !pendiente && setConfirmando(abierto)}>
          <DialogContent className="sm:max-w-md" aria-describedby={undefined}>
            <DialogHeader>
              <DialogTitle>
                {sinCobrar.numero} sin cobrar · <span className="tabular">{moneda.format(sinCobrar.monto)}</span>
              </DialogTitle>
            </DialogHeader>
            <div className="flex flex-wrap justify-end gap-2 pt-2">
              <button
                type="button"
                disabled={pendiente}
                onClick={() => accion(() => avanzarPedido(id))}
                className="inline-flex h-11 items-center gap-2 rounded-lg px-4 text-base font-medium hover:bg-hundida disabled:opacity-50"
              >
                Entregar sin cobrar
              </button>
              {/* Cobrar ahí mismo, con recibo: antes había que cerrar, buscar
                  «Cobrar» en la tarjeta y volver a entregar. Quien no cobra no
                  ve el cobro. */}
              {cobro && (
                <button
                  type="button"
                  autoFocus
                  disabled={pendiente}
                  onClick={() => {
                    setConfirmando(false);
                    setCobrandoParaEntregar(true);
                  }}
                  className="boton-accion inline-flex h-11 items-center gap-2 rounded-lg px-4 text-base font-medium disabled:opacity-50"
                >
                  Cobrar <span className="tabular">{moneda.format(sinCobrar.monto)}</span> y entregar
                </button>
              )}
            </div>
          </DialogContent>
        </Dialog>
      )}

      {preguntar && sinCobrar && cobro && (
        <DialogoCobro
          sinBoton
          abierto={cobrandoParaEntregar}
          alCambiarAbierto={setCobrandoParaEntregar}
          customerId={cobro.customerId}
          nombre={cobro.nombre}
          aCobrar={sinCobrar.monto}
          pedido={{ id, numero: cobro.numero }}
          alCobrar={() => accion(() => avanzarPedido(id))}
        />
      )}
    </div>
  );
}

/**
 * Cancelar el pedido, con el motivo. Libera lo reservado y, si cargó deuda,
 * la devuelve. La acción existía en el servidor y no tenía botón: un pedido
 * que el cliente no quería más quedaba en el tablero para siempre.
 */
export function CancelarPedido({ id, numero, cobrado }: { id: string; numero: string; cobrado: boolean }) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [pendiente, startTransition] = useTransition();

  function cancelar() {
    startTransition(async () => {
      const r = await cancelarPedido(id, motivo.trim() || undefined);
      if (r.error) toast.error(r.error);
      else {
        toast.success(r.ok ?? "Pedido cancelado.");
        setAbierto(false);
        router.refresh();
      }
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className="inline-flex h-10 items-center gap-1.5 rounded-lg px-3 text-base font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <Ban className="h-5 w-5" />
        Cancelar pedido
      </button>
      <Dialog open={abierto} onOpenChange={setAbierto}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Cancelar el pedido {numero}</DialogTitle>
          </DialogHeader>
          {cobrado && (
            <p className="estado-espera rounded-lg bg-[var(--estado-fondo)] px-3.5 py-2.5 text-base text-[var(--estado-tinta)]">
              Ya está cobrado: la plata no vuelve sola, hay que devolvérsela.
            </p>
          )}
          <label htmlFor="motivo-cancelacion" className="text-base font-medium">
            Por qué
          </label>
          <Textarea
            id="motivo-cancelacion"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            maxLength={500}
            rows={3}
          />
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setAbierto(false)}
              className="h-11 rounded-lg px-4 text-base font-medium hover:bg-hundida"
            >
              Mejor no
            </button>
            <button
              type="button"
              disabled={pendiente}
              onClick={cancelar}
              className="inline-flex h-11 items-center gap-2 rounded-lg bg-destructive px-4 text-base font-medium text-white disabled:opacity-50"
            >
              {pendiente && <Loader2 className="h-4 w-4 animate-spin" />}
              Cancelar el pedido
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
