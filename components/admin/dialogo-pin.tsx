"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cargarPin } from "@/app/admin/pin-actions";

const CAMPO =
  "mt-1 block h-12 w-full rounded-lg border border-linea bg-hundida px-3 text-base text-foreground";

/**
 * Cargar o cambiar el PIN de autorización. Pide la clave de la cuenta: quien
 * encuentre la sesión abierta no puede ponerle un PIN propio.
 */
export function DialogoPin({ abierto, alCerrar }: { abierto: boolean; alCerrar: () => void }) {
  const [clave, setClave] = useState("");
  const [pin, setPin] = useState("");
  const [otraVez, setOtraVez] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pendiente, empezar] = useTransition();

  const forma = /^\d{6,8}$/.test(pin);
  const coinciden = pin === otraVez;

  function cerrar() {
    setClave("");
    setPin("");
    setOtraVez("");
    setError(null);
    alCerrar();
  }

  function guardar(e: React.FormEvent) {
    e.preventDefault();
    if (!forma) return setError("De 6 a 8 números.");
    if (!coinciden) return setError("Los dos PIN no coinciden.");
    empezar(async () => {
      const r = await cargarPin(clave, pin);
      if (r.error) {
        setError(r.error);
        return;
      }
      toast.success(r.ok ?? "PIN guardado.");
      cerrar();
    });
  }

  return (
    <Dialog open={abierto} onOpenChange={(a) => !a && !pendiente && cerrar()}>
      <DialogContent className="sm:max-w-sm" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>PIN de autorización</DialogTitle>
        </DialogHeader>
        <form onSubmit={guardar} className="space-y-3">
          <label className="block text-sm text-muted-foreground">
            Tu contraseña
            <input
              type="password"
              autoComplete="current-password"
              autoFocus
              value={clave}
              onChange={(e) => setClave(e.target.value)}
              className={CAMPO}
            />
          </label>
          <label className="block text-sm text-muted-foreground">
            PIN nuevo
            <input
              type="password"
              inputMode="numeric"
              autoComplete="off"
              maxLength={8}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
              className={`${CAMPO} tabular tracking-[0.4em]`}
            />
          </label>
          <label className="block text-sm text-muted-foreground">
            Otra vez
            <input
              type="password"
              inputMode="numeric"
              autoComplete="off"
              maxLength={8}
              value={otraVez}
              onChange={(e) => setOtraVez(e.target.value.replace(/\D/g, ""))}
              aria-invalid={otraVez.length > 0 && !coinciden}
              className={`${CAMPO} tabular tracking-[0.4em]`}
            />
          </label>
          {error && (
            <p role="alert" className="estado-problema text-base font-medium">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={cerrar}
              className="h-11 rounded-lg px-4 text-base font-medium hover:bg-hundida"
            >
              Mejor no
            </button>
            <button
              type="submit"
              disabled={pendiente || !clave || !forma || !coinciden}
              className="boton-accion inline-flex h-11 items-center gap-2 rounded-lg px-4 text-base font-medium disabled:opacity-50"
            >
              {pendiente && <Loader2 className="h-4 w-4 animate-spin" />}
              Guardar
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
