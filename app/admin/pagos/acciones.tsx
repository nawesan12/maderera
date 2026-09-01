"use client";

import { useActionState } from "react";
import { Check, ExternalLink, Loader2, RefreshCw, X } from "lucide-react";
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
}: {
  pagoId: string;
  estado: string;
  proveedor: string;
  comprobanteUrl: string | null;
}) {
  const [resultado, conciliar, conciliando] = useActionState(
    conciliarTransferencia,
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
          <form action={conciliar}>
            <input type="hidden" name="pagoId" value={pagoId} />
            <input type="hidden" name="decision" value="aprobar" />
            <button
              type="submit"
              disabled={conciliando}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-brand-orange px-3 text-base font-medium text-white transition-colors hover:bg-brand-orange-dark disabled:opacity-60"
            >
              {conciliando ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Check className="h-4 w-4" />
              )}
              Acreditar
            </button>
          </form>

          <form action={conciliar}>
            <input type="hidden" name="pagoId" value={pagoId} />
            <input type="hidden" name="decision" value="rechazar" />
            <button
              type="submit"
              disabled={conciliando}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-base font-medium transition-colors hover:bg-muted disabled:opacity-60"
            >
              <X className="h-4 w-4" />
              Rechazar
            </button>
          </form>
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
