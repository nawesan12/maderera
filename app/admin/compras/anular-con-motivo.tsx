"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Ban, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * Anular un pago o una factura de compra: un botón que abre la confirmación
 * con el motivo.
 *
 * Sigue las dos reglas de components/admin/confirmar.tsx —el título nombra la
 * cosa con su monto, el detalle dice qué no tiene vuelta— pero tiene su
 * propio diálogo porque pide un dato: el motivo, que queda en la bitácora y
 * en la ficha. Es la excepción que ese componente anota.
 *
 * Antes la anulación del pago vivía en un desplegable metido en la celda de
 * la fecha del listado, con tres renglones de explicación: se abría sin
 * querer al leer la tabla y no decía de cuánto era el pago.
 */
export function AnularConMotivo({
  titulo,
  detalle,
  boton = "Anular",
  compacto = false,
  confirmar,
  anular,
  alTerminar,
}: {
  /** Solo el ícono, para un renglón de un listado: el título es su rótulo. */
  compacto?: boolean;
  /** «Anular el pago de $ 120.000 a Maderas del Sur». */
  titulo: string;
  detalle: string;
  boton?: string;
  confirmar: string;
  anular: (motivo: string) => Promise<{ error?: string; ok?: string }>;
  alTerminar?: (ok: string) => void;
}) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState<string>();
  const [enCurso, empezar] = useTransition();

  return (
    <>
      {compacto ? (
        <button
          type="button"
          onClick={() => setAbierto(true)}
          aria-label={titulo}
          title={boton}
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-muted-foreground hover:bg-hundida hover:text-saldo-debe"
        >
          <Ban className="h-4 w-4" aria-hidden="true" />
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setAbierto(true)}
          className="tarjeta-hundida inline-flex h-11 items-center gap-2 rounded-xl px-4 text-base font-medium text-saldo-debe"
        >
          <Ban className="h-4 w-4" aria-hidden="true" />
          {boton}
        </button>
      )}

      <Dialog open={abierto} onOpenChange={(v) => !v && setAbierto(false)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{titulo}</DialogTitle>
            <DialogDescription className="text-base">{detalle}</DialogDescription>
          </DialogHeader>

          <label className="block">
            <span className="text-base font-medium">Motivo</span>
            <input
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              autoFocus
              className="mt-1 h-11 w-full rounded-lg border border-linea bg-card px-3 text-base"
            />
          </label>
          {error && (
            <p className="text-base text-saldo-debe" role="alert">
              {error}
            </p>
          )}

          <div className="flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={() => setAbierto(false)}
              className="tarjeta-hundida h-11 rounded-lg px-4 text-base font-medium"
            >
              Mejor no
            </button>
            <button
              type="button"
              disabled={enCurso || motivo.trim() === ""}
              onClick={() =>
                empezar(async () => {
                  const r = await anular(motivo);
                  if (r.error) {
                    setError(r.error);
                    return;
                  }
                  setAbierto(false);
                  setMotivo("");
                  router.refresh();
                  alTerminar?.(r.ok ?? "");
                })
              }
              className="inline-flex h-11 items-center gap-2 rounded-lg bg-destructive px-4 text-base font-medium text-white disabled:opacity-50"
            >
              {enCurso && <Loader2 className="h-4 w-4 animate-spin" />}
              {confirmar}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
