"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowRight, Ban, Check, Loader2 } from "lucide-react";
import { avanzarPedido, cancelarPedido, marcarPagado } from "@/app/admin/ventas-actions";
import { DialogoCobro } from "@/components/cobros/dialogo-cobro";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { MEDIOS_DEL_PEDIDO, Opciones } from "@/components/admin/opciones";
import { moneda } from "@/components/admin/formato";

type Medio = (typeof MEDIOS_DEL_PEDIDO)[number]["valor"];

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
  cobroACuenta,
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
   * Si el pedido es a cuenta corriente de un cliente, «Cobrar» abre el cobro
   * con recibo: hay que decir con qué pagó, y ese pago baja la deuda. Marcarlo
   * pagado a secas bajaba la deuda sin saber con qué se pagó.
   */
  cobroACuenta?: { customerId: string; nombre: string; numero: string; total: number } | null;
  /**
   * Para cobrar el resto: con qué pagó. Marcarlo pagado sin preguntar dejaba
   * el pedido cobrado sin saber cómo entró la plata. Sin esto (quien no
   * cobra), el botón no aparece.
   */
  cobro?: { numero: string; total: number; medioPago: string | null } | null;
  /**
   * Lo que falta cobrar fuera de la cuenta corriente (`sinCobrar` del
   * pedido, la misma regla que «Me deben»). Con algo, «Marcar entregado»
   * pregunta antes: no se bloquea, porque existe el pago contra entrega,
   * pero la mercadería no sale sin que nadie lo mire. El servidor deja la
   * firma en el historial igual.
   */
  sinCobrar?: { numero: string; monto: number } | null;
}) {
  const router = useRouter();
  const [pendiente, startTransition] = useTransition();
  const [confirmando, setConfirmando] = useState(false);

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
      {estadoPago !== "pagado" && estado !== "cancelado" && cobroACuenta && (
        <DialogoCobro
          customerId={cobroACuenta.customerId}
          nombre={cobroACuenta.nombre}
          aCobrar={cobroACuenta.total}
          orderId={id}
          numeroPedido={cobroACuenta.numero}
          etiqueta="Cobrar"
          claseBoton={`inline-flex h-10 items-center justify-center gap-1.5 rounded-lg border px-3 text-base font-medium transition-colors hover:bg-muted ${compacto ? "min-w-0 flex-1 basis-0" : ""}`}
        />
      )}

      {estadoPago !== "pagado" && estado !== "cancelado" && !cobroACuenta && cobro && (
        <CobrarPedido
          id={id}
          {...cobro}
          clase={`inline-flex h-10 items-center justify-center gap-1.5 rounded-lg border px-3 text-base font-medium transition-colors hover:bg-muted disabled:opacity-50 ${compacto ? "min-w-0 flex-1 basis-0" : ""}`}
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
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>
                {sinCobrar.numero} sin cobrar · <span className="tabular">{moneda.format(sinCobrar.monto)}</span>
              </DialogTitle>
            </DialogHeader>
            {/* «Mejor no» es el botón fuerte y el que tiene el foco: un Enter
                apurado no entrega mercadería sin cobrar. */}
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                disabled={pendiente}
                onClick={() => accion(() => avanzarPedido(id))}
                className="inline-flex h-11 items-center gap-2 rounded-lg px-4 text-base font-medium hover:bg-hundida disabled:opacity-50"
              >
                {pendiente && <Loader2 className="h-4 w-4 animate-spin" />}
                Entregar igual
              </button>
              <button
                type="button"
                autoFocus
                disabled={pendiente}
                onClick={() => setConfirmando(false)}
                className="boton-accion h-11 rounded-lg px-4 text-base font-medium disabled:opacity-50"
              >
                Mejor no
              </button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

/** Cobrar un pedido que no es a cuenta corriente: con qué pagó, y listo. */
function CobrarPedido({
  id,
  numero,
  total,
  medioPago,
  clase,
}: {
  id: string;
  numero: string;
  total: number;
  medioPago: string | null;
  clase: string;
}) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [pendiente, startTransition] = useTransition();
  const propuesto = MEDIOS_DEL_PEDIDO.find((m) => m.valor === medioPago)?.valor ?? null;
  const [medio, setMedio] = useState<Medio | null>(propuesto);

  function cobrar() {
    if (!medio) return;
    startTransition(async () => {
      const r = await marcarPagado(id, medio);
      if (r.error) toast.error(r.error);
      else {
        toast.success(r.ok ?? "Cobrado.");
        setAbierto(false);
        router.refresh();
      }
    });
  }

  return (
    <>
      <button type="button" onClick={() => setAbierto(true)} className={clase}>
        <Check className="h-5 w-5" />
        Cobrar
      </button>
      <Dialog open={abierto} onOpenChange={setAbierto}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              Cobrar {numero} · <span className="tabular">{moneda.format(total)}</span>
            </DialogTitle>
          </DialogHeader>
          <Opciones etiqueta="Con qué pagó" valor={medio} alCambiar={setMedio} opciones={[...MEDIOS_DEL_PEDIDO]} />
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
              disabled={!medio || pendiente}
              onClick={cobrar}
              className="boton-accion inline-flex h-11 items-center gap-2 rounded-lg px-4 text-base font-medium disabled:opacity-50"
            >
              {pendiente && <Loader2 className="h-4 w-4 animate-spin" />}
              Cobrado
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </>
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
