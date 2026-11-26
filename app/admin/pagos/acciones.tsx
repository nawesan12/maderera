"use client";

import { useActionState, useId, useState } from "react";
import { Check, ExternalLink, Loader2, RefreshCw, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  conciliarTransferencia,
  reconsultarCobro,
  type EstadoAccionPago,
} from "./actions";

const inicial: EstadoAccionPago = {};

/**
 * Acciones sobre un cobro.
 *
 * Solo aparecen las que tienen sentido para ese estado: confirmar o rechazar
 * una transferencia que espera verificación, y reconsultar un cobro de Mercado
 * Pago cuyo aviso se perdió. Mostrar botones que no hacen nada es la forma más
 * rápida de que se deje de confiar en la pantalla.
 */
export function AccionesCobro({
  pagoId,
  estado,
  proveedor,
  comprobanteUrl,
  cliente,
  monto,
  revisar,
}: {
  pagoId: string;
  estado: string;
  proveedor: string;
  comprobanteUrl: string | null;
  /** Para el título del rechazo: nombra el cobro, no la acción. */
  cliente?: string | null;
  monto?: string;
  /** Si hay algo que mirar antes de acreditar (repetido, cuenta en cero): pide confirmar. */
  revisar?: string;
}) {
  const [confirmando, setConfirmando] = useState(false);
  /*
   * Rechazar una transferencia pide motivo y se confirma en un diálogo: antes
   * era un botón suelto pegado a «Acreditar», sin preguntar nada, y el motivo
   * —que el cliente lee en el aviso y en Mi cuenta— no se podía escribir.
   */
  const [rechazando, setRechazando] = useState(false);
  const [motivo, setMotivo] = useState("");
  const idMotivo = useId();
  const [resultado, conciliar, conciliando] = useActionState(
    async (previo: EstadoAccionPago, formData: FormData) => {
      const r = await conciliarTransferencia(previo, formData);
      if (r.ok) setRechazando(false);
      return r;
    },
    inicial,
  );
  const [consulta, reconsultar, consultando] = useActionState(
    reconsultarCobro,
    inicial,
  );

  const mensaje = resultado.error ?? resultado.ok ?? consulta.error ?? consulta.ok;
  const esError = Boolean(resultado.error ?? consulta.error);

  return (
    <div className="flex w-full flex-wrap items-center justify-end gap-2 sm:w-auto">
      {comprobanteUrl && (
        <a
          href={comprobanteUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-base font-medium transition-colors hover:bg-muted"
        >
          <ExternalLink className="h-4 w-4" />
          Comprobante
        </a>
      )}

      {estado === "en_revision" && (
        <>
          <form
            action={conciliar}
            onSubmit={(e) => {
              if (revisar && !confirmando) {
                e.preventDefault();
                setConfirmando(true);
              }
            }}
          >
            <input type="hidden" name="pagoId" value={pagoId} />
            <input type="hidden" name="decision" value="aprobar" />
            {confirmando && revisar && (
              <span className="estado-problema mb-1.5 block max-w-72 text-right text-base font-medium" role="alert">
                {revisar}
              </span>
            )}
            <button
              type="submit"
              disabled={conciliando}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-accion px-3 text-base font-medium text-white transition-colors hover:bg-brand-orange-dark disabled:opacity-60"
            >
              {conciliando ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Check className="h-4 w-4" />
              )}
              {confirmando ? "Acreditar igual" : "Acreditar"}
            </button>
          </form>

          <button
            type="button"
            disabled={conciliando}
            onClick={() => setRechazando(true)}
            className="inline-flex h-11 items-center gap-1.5 rounded-lg px-3 text-base font-medium text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-60"
          >
            <X className="h-4 w-4" />
            Rechazar
          </button>

          <Dialog open={rechazando} onOpenChange={(v) => !v && setRechazando(false)}>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>
                  Rechazar la transferencia{cliente ? ` de ${cliente}` : ""}
                  {monto ? ` por ${monto}` : ""}
                </DialogTitle>
              </DialogHeader>
              <form action={conciliar} className="space-y-3">
                <input type="hidden" name="pagoId" value={pagoId} />
                <input type="hidden" name="decision" value="rechazar" />
                <label htmlFor={idMotivo} className="block text-base font-medium">
                  Motivo
                </label>
                <input
                  id={idMotivo}
                  name="motivo"
                  autoFocus
                  data-enter="enviar"
                  maxLength={300}
                  value={motivo}
                  onChange={(e) => setMotivo(e.target.value)}
                  placeholder="No está en el extracto, el importe no coincide…"
                  className="h-11 w-full rounded-lg border border-linea bg-background px-3 text-base"
                />
                {resultado.error && (
                  <p className="estado-problema text-base font-medium">{resultado.error}</p>
                )}
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setRechazando(false)}
                    className="h-11 rounded-lg px-4 text-base font-medium transition-colors hover:bg-hundida"
                  >
                    Volver
                  </button>
                  <button
                    type="submit"
                    disabled={conciliando || !motivo.trim()}
                    className="inline-flex h-11 items-center gap-2 rounded-lg bg-destructive px-4 text-base font-medium text-white disabled:opacity-50"
                  >
                    {conciliando && <Loader2 className="h-4 w-4 animate-spin" />}
                    Rechazar
                  </button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        </>
      )}

      {proveedor === "mercado_pago" &&
        (estado === "iniciado" || estado === "pendiente") && (
          <form action={reconsultar}>
            <input type="hidden" name="pagoId" value={pagoId} />
            <button
              type="submit"
              disabled={consultando}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-base font-medium transition-colors hover:bg-muted disabled:opacity-60"
            >
              {consultando ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              Consultar
            </button>
          </form>
        )}

      {mensaje && (
        <p
          className={`w-full text-right text-base ${esError ? "text-destructive" : "text-muted-foreground"}`}
        >
          {mensaje}
        </p>
      )}
    </div>
  );
}
