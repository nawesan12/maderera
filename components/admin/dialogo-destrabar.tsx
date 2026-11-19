"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { destrabarPin } from "@/app/admin/pin-actions";

/**
 * Destrabar el PIN: diez errores en el día (o cinco seguidos en un
 * mostrador) frenan todas las autorizaciones. El admin las destraba con su
 * contraseña, sin tener que atender él con su sesión.
 */
export function DialogoDestrabar({ abierto, alCerrar }: { abierto: boolean; alCerrar: () => void }) {
  const [clave, setClave] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pendiente, empezar] = useTransition();

  function cerrar() {
    setClave("");
    setError(null);
    alCerrar();
  }

  function destrabar(e: React.FormEvent) {
    e.preventDefault();
    empezar(async () => {
      const r = await destrabarPin(clave);
      if (r.error) {
        setError(r.error);
        return;
      }
      toast.success(r.ok ?? "Autorizaciones destrabadas.");
      cerrar();
    });
  }

  return (
    <Dialog open={abierto} onOpenChange={(a) => !a && !pendiente && cerrar()}>
      <DialogContent className="sm:max-w-sm" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>Destrabar el PIN</DialogTitle>
        </DialogHeader>
        <form onSubmit={destrabar} className="space-y-3">
          <label className="block text-sm text-muted-foreground">
            Tu contraseña
            <input
              type="password"
              autoComplete="current-password"
              autoFocus
              value={clave}
              onChange={(e) => {
                setClave(e.target.value);
                setError(null);
              }}
              aria-invalid={Boolean(error) || undefined}
              className="mt-1 block h-12 w-full rounded-lg border border-linea bg-hundida px-3 text-base text-foreground"
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
              disabled={pendiente || !clave}
              className="boton-accion inline-flex h-11 items-center gap-2 rounded-lg px-4 text-base font-medium disabled:opacity-50"
            >
              {pendiente && <Loader2 className="h-4 w-4 animate-spin" />}
              Destrabar
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
