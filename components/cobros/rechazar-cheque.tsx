"use client";

import { useState, useTransition } from "react";
import { Ban, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { rechazarChequeDesdeLaFicha } from "@/app/admin/cobros-actions";
import { CampoPin, type Autorizacion } from "@/components/autorizacion/campo-pin";

const PESOS = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", minimumFractionDigits: 2 });

/**
 * «Rechazado»: el banco devolvió un cheque que entregó el cliente (H272). Lo
 * muestra la ficha a quien maneja plata, en el renglón del cheque o del pago
 * que lo trajo. Como anular un recibo, va en un diálogo con el motivo (lo lee
 * el cliente) y, si quien lo registra no es admin, el PIN de uno.
 */
export function RechazarCheque({
  id,
  nombre,
  importe,
  cliente,
  conNombre = false,
}: {
  id: string;
  nombre: string;
  importe: number;
  cliente?: string;
  /** En un pago con varios cheques el botón dice cuál. */
  conNombre?: boolean;
}) {
  const [abierto, setAbierto] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState<string | null>(null);
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
      setError("Poné el motivo del rechazo: lo lee el cliente.");
      return;
    }
    empezar(async () => {
      const r = await rechazarChequeDesdeLaFicha(id, motivo, pin);
      if (r.ok) {
        toast.success(r.ok);
        cerrar();
      } else if (r.autorizacion) {
        setPidePin(r.autorizacion);
        setError(null);
      } else {
        setError(r.error ?? "No se pudo registrar el rechazo.");
      }
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setAbierto(true)}
        aria-label={`Registrar que el banco rechazó el ${nombre}`}
        className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-sm font-medium text-saldo-debe ring-1 ring-destructive/30 transition-colors hover:bg-destructive/10"
      >
        <Ban className="h-3.5 w-3.5" />
        {conNombre ? `${nombre.replace(/^.* N° /, "N° ")} rechazado` : "Rechazado"}
      </button>

      <Dialog open={abierto} onOpenChange={(v) => (v ? setAbierto(true) : cerrar())}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="[overflow-wrap:anywhere]">{nombre}, rechazado</DialogTitle>
            <DialogDescription className="text-base">
              {PESOS.format(importe)} vuelven a la cuenta{cliente ? ` de ${cliente}` : ""} con una nota de débito.
            </DialogDescription>
          </DialogHeader>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              enviar();
            }}
            className="space-y-3"
          >
            <label className="block">
              <span className="text-sm font-medium">Motivo</span>
              <Textarea
                value={motivo}
                onChange={(e) => {
                  setMotivo(e.target.value);
                  setError(null);
                }}
                maxLength={300}
                rows={2}
                autoFocus
                aria-invalid={Boolean(error) || undefined}
                aria-describedby={error ? `error-rechazo-${id}` : undefined}
                placeholder="Sin fondos"
                className="mt-1 min-h-16"
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
              <p id={`error-rechazo-${id}`} role="alert" className="text-base text-saldo-debe">
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
                Registrar el rechazo
              </button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
