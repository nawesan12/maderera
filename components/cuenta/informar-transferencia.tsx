"use client";

import { useActionState, useState, useTransition, type FormEvent } from "react";
import { AlertCircle, Check, Copy, Loader2, Upload } from "lucide-react";
import { subirComprobante, type EstadoPago } from "@/app/(public)/pago-actions";
import type { DatosParaTransferir } from "@/lib/dal/pagos";

const inicial: EstadoPago = {};

/**
 * «Informar el pago» de un pedido por transferencia, en Mi cuenta.
 *
 * El cliente sin cuenta corriente no tenía dónde subir el comprobante de su
 * pedido: la tarjeta decía «te pasamos los datos por WhatsApp» y nada más
 * (mes simulado, H387). Es el mismo camino que la página del pedido
 * (`subirComprobante`): la sesión del dueño autoriza, sin token.
 *
 * El formulario se manda con `onSubmit` y no con `action`: con `action`,
 * React lo vacía al volver, y un error se llevaba el archivo elegido (H076).
 */
export function InformarTransferencia({
  numero,
  banco,
}: {
  numero: string;
  banco: DatosParaTransferir | null;
}) {
  const [estado, accion] = useActionState(subirComprobante, inicial);
  const [enviando, empezar] = useTransition();
  const [copiado, setCopiado] = useState<string | null>(null);

  function enviar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const datos = new FormData(e.currentTarget);
    empezar(() => accion(datos));
  }

  async function copiar(valor: string) {
    try {
      await navigator.clipboard.writeText(valor);
      setCopiado(valor);
      setTimeout(() => setCopiado(null), 2000);
    } catch {
      // Sin portapapeles el dato sigue a la vista para copiarlo a mano.
    }
  }

  if (estado.ok) {
    return (
      <p className="estado-ok mt-3 flex items-start gap-2 rounded-lg bg-[var(--estado-fondo)] p-3 text-sm">
        <Check className="mt-0.5 h-4 w-4 shrink-0" />
        {estado.ok}
      </p>
    );
  }

  return (
    <div className="mt-3 space-y-3">
      {banco && (
        <dl className="space-y-1.5 rounded-lg bg-hundida p-3.5 text-sm">
          {(
            [
              ["Titular", banco.titular, false],
              ["CBU", banco.cbu, true],
              ["Alias", banco.alias, true],
              ["CUIT", banco.cuit, false],
            ] as const
          )
            .filter(([, valor]) => Boolean(valor))
            .map(([etiqueta, valor, copiable]) => (
              <div
                key={etiqueta}
                className="flex items-center justify-between gap-3"
              >
                <dt className="text-muted-foreground">{etiqueta}</dt>
                <dd className="tabular flex min-w-0 items-center gap-1 font-medium [overflow-wrap:anywhere]">
                  {valor}
                  {copiable && (
                    <button
                      type="button"
                      onClick={() => copiar(valor)}
                      aria-label={`Copiar ${etiqueta}`}
                      className="-my-2 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-black/5 hover:text-foreground"
                    >
                      {copiado === valor ? (
                        <Check className="h-4 w-4" />
                      ) : (
                        <Copy className="h-4 w-4" />
                      )}
                    </button>
                  )}
                </dd>
              </div>
            ))}
        </dl>
      )}

      <form onSubmit={enviar} className="space-y-3">
        <input type="hidden" name="numero" value={numero} />
        <label
          className="block text-sm font-medium"
          htmlFor={`comprobante-${numero}`}
        >
          Comprobante
        </label>
        <input
          id={`comprobante-${numero}`}
          name="comprobante"
          type="file"
          accept="image/jpeg,image/png,image/webp,application/pdf"
          required
          className="h-11 w-full rounded-lg bg-hundida px-3 py-2 text-sm"
        />
        {estado.error && (
          <p
            role="alert"
            className="estado-problema flex items-start gap-2 rounded-lg bg-[var(--estado-fondo)] p-3 text-sm"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            {estado.error}
          </p>
        )}
        <button
          type="submit"
          disabled={enviando}
          className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-accion px-5 font-medium text-white transition-colors hover:bg-brand-orange-dark disabled:opacity-60"
        >
          {enviando ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Upload className="h-4 w-4" />
          )}
          Informar el pago
        </button>
      </form>
    </div>
  );
}
