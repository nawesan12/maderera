"use client";

import { useState, useTransition } from "react";
import { Loader2, Undo2 } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { anularReciboDesdeElPanel } from "@/app/admin/cobros-actions";
import { CampoPin, type Autorizacion } from "@/components/autorizacion/campo-pin";

// Con centavos: es lo que vuelve a deber, y redondeado no coincide con el recibo.
const PESOS = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", minimumFractionDigits: 2 });

/**
 * «Anular» un recibo vivo, con motivo obligatorio. Lo muestra la ficha a
 * quien maneja plata (MANEJAN_PLATA).
 *
 * Va en un diálogo y no abierto en la fila (comité del 25/11): ahí el motivo,
 * de hasta 300 caracteres, entraba en 89 px, y no decía qué pasaba con la
 * deuda. Es irreversible, así que el diálogo dice la consecuencia con el
 * importe. Si Go lo frena —plata ya devuelta con una devolución, un cheque que
 * salió de la cartera— el motivo queda adentro del diálogo; al cerrarlo se
 * limpia, así no reaparece un error viejo.
 */
export function AnularRecibo({
  id,
  numero,
  importe,
  cliente,
  sinCuenta = false,
}: {
  id: string;
  numero: string;
  /** Lo que vuelve a deber, en positivo. */
  importe?: number;
  cliente?: string;
  /**
   * Quien pagó no tiene ficha (una factura manual): no hay cuenta adonde
   * volver, vuelve a deberse la factura (recorrido 2).
   */
  sinCuenta?: boolean;
}) {
  const [abierto, setAbierto] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState<string | null>(null);
  // Quien no es admin anula con el PIN de uno (como una venta): Go lo pide.
  const [pidePin, setPidePin] = useState<Autorizacion | null>(null);
  const [pendiente, empezar] = useTransition();

  function cerrar() {
    setAbierto(false);
    setMotivo("");
    setError(null);
    setPidePin(null);
  }

  function enviar(pin?: string) {
    if (!motivo.trim()) {
      setError("Poné el motivo de la anulación.");
      return;
    }
    empezar(async () => {
      const r = await anularReciboDesdeElPanel(id, motivo, pin);
      if (r.ok) {
        toast.success(r.ok);
        cerrar();
      } else if (r.autorizacion) {
        setPidePin(r.autorizacion);
        setError(null);
      } else {
        setError(r.error ?? "No se pudo anular.");
      }
    });
  }

  function anular(e: React.FormEvent) {
    e.preventDefault();
    enviar();
  }

  const consecuencia = sinCuenta
    ? `La factura vuelve a deber ${importe && importe > 0 ? PESOS.format(importe) : "lo que se pagó"}. No se puede deshacer.`
    : importe && importe > 0
      ? `${PESOS.format(importe)} vuelven a la cuenta${cliente ? ` de ${cliente}` : ""}. No se puede deshacer.`
      : "Lo que pagó vuelve a la cuenta. No se puede deshacer.";

  return (
    <>
      <button
        type="button"
        onClick={() => setAbierto(true)}
        aria-label={`Anular el recibo ${numero}`}
        className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-sm font-medium text-saldo-debe ring-1 ring-destructive/30 transition-colors hover:bg-destructive/10"
      >
        <Undo2 className="h-3.5 w-3.5" />
        Anular
      </button>

      <Dialog open={abierto} onOpenChange={(v) => (v ? setAbierto(true) : cerrar())}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              Anular <span className="tabular whitespace-nowrap">{numero}</span>
            </DialogTitle>
            <DialogDescription className="text-base">{consecuencia}</DialogDescription>
          </DialogHeader>

          <form onSubmit={anular} className="space-y-3">
            <label className="block">
              <span className="text-sm font-medium">Motivo</span>
              <Textarea
                value={motivo}
                onChange={(e) => {
                  setMotivo(e.target.value);
                  setError(null);
                }}
                maxLength={300}
                rows={3}
                aria-label={`Motivo para anular el recibo ${numero}`}
                autoFocus
                aria-invalid={Boolean(error) || undefined}
                aria-describedby={error ? `error-anular-${id}` : undefined}
                placeholder="Por qué se anula"
                className="mt-1 min-h-20"
              />
            </label>

            {pidePin && (
              <CampoPin
                autorizacion={pidePin}
                enviando={pendiente}
                onEnviar={(pin) => enviar(pin)}
                onCancelar={() => setPidePin(null)}
              />
            )}

            {error && (
              <p id={`error-anular-${id}`} role="alert" className="text-base text-saldo-debe">
                {error}
              </p>
            )}

            <div className="flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={cerrar}
                className="h-11 rounded-lg border border-linea px-4 text-base font-medium transition-colors hover:bg-hundida"
              >
                Mejor no
              </button>
              <button
                type="submit"
                disabled={pendiente || Boolean(pidePin)}
                className="inline-flex h-11 items-center gap-2 rounded-lg bg-destructive px-4 text-base font-medium text-white transition-opacity disabled:opacity-50"
              >
                {pendiente && <Loader2 className="h-4 w-4 animate-spin" />}
                Anular el recibo
              </button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
