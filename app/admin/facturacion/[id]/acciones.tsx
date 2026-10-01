"use client";

import { useActionState, useState } from "react";
import { AlertCircle, Check, Loader2, Send, Undo2, Wallet } from "lucide-react";
import { toast } from "sonner";
import {
  anular,
  autorizar,
  registrarCobro,
  type EstadoFactura,
} from "../actions";
import { CobroMultimedio } from "@/components/cobros/cobro-multimedio";

const inicial: EstadoFactura = {};

/** Manda el comprobante a ARCA. Se puede reintentar si fue rechazado. */
export function BotonAutorizar({
  id,
  rechazado,
}: {
  id: string;
  rechazado: boolean;
}) {
  const [estado, accion, pendiente] = useActionState(autorizar, inicial);

  return (
    <div className="space-y-2">
      <form action={accion}>
        <input type="hidden" name="id" value={id} />
        <button
          type="submit"
          disabled={pendiente}
          className="inline-flex h-10 items-center gap-2 rounded-lg bg-brand-orange px-4 text-base font-medium text-white transition-colors hover:bg-brand-orange-dark disabled:opacity-60"
        >
          {pendiente ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : (
            <Send className="h-5 w-5" />
          )}
          {rechazado ? "Reenviar a ARCA" : "Autorizar en ARCA"}
        </button>
      </form>

      {estado.error && (
        <p
          role="alert"
          className="estado-problema flex items-start gap-2 rounded-lg bg-[var(--estado-fondo)] px-3 py-2 text-base text-[var(--estado-tinta)]"
        >
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
          {estado.error}
        </p>
      )}
      {estado.ok && (
        <p
          role="status"
          className="estado-ok flex items-start gap-2 rounded-lg bg-[var(--estado-fondo)] px-3 py-2 text-base text-[var(--estado-tinta)]"
        >
          <Check className="mt-0.5 h-5 w-5 shrink-0" />
          {estado.ok}
        </p>
      )}
    </div>
  );
}

/**
 * Cobro parcial o total, con uno o varios medios.
 *
 * Cobrar emite un recibo (`CobroMultimedio` + `emitirRecibo`); pasar a cuenta
 * corriente no es un pago y va aparte, con su propio botón, para que nadie lo
 * elija de una lista de medios creyendo que cobró.
 */
export function FormularioCobro({
  id,
  saldo,
  conCliente,
}: {
  id: string;
  saldo: number;
  conCliente: boolean;
}) {
  const [estado, accion, pendiente] = useActionState(
    async (previo: EstadoFactura, formData: FormData) => {
      const r = await registrarCobro(previo, formData);
      /*
       * El aviso va por `toast` y no solo en el formulario: cuando el cobro
       * salda la factura, el formulario desaparece con el refresco y el enlace
       * al recibo se iba con él justo cuando el cliente está esperando el papel.
       */
      if (r.ok) {
        toast.success(r.ok, {
          duration: 12_000,
          action: r.receiptId
            ? {
                label: "Imprimir recibo",
                onClick: () => window.open(`/api/recibos/${r.receiptId}/pdf`, "_blank"),
              }
            : undefined,
        });
      }
      return r;
    },
    inicial,
  );
  const [modo, setModo] = useState<"cobrar" | "cuenta_corriente">("cobrar");

  return (
    <form action={accion} className="space-y-3">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="modo" value={modo} />

      {conCliente && (
        <div className="flex rounded-lg border border-linea p-0.5 text-base" role="group">
          {(
            [
              ["cobrar", "Cobrar ahora"],
              ["cuenta_corriente", "Pasar a cuenta corriente"],
            ] as const
          ).map(([valor, texto]) => (
            <button
              key={valor}
              type="button"
              onClick={() => setModo(valor)}
              aria-pressed={modo === valor}
              className={`h-10 flex-1 rounded-md px-3 font-medium transition-colors ${
                modo === valor ? "bg-hundida" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {texto}
            </button>
          ))}
        </div>
      )}

      {modo === "cobrar" ? (
        <CobroMultimedio
          aCobrar={saldo}
          medios={["efectivo", "transferencia", "deposito", "cheque", "echeq", "tarjeta_debito", "tarjeta_credito", "mercado_pago"]}
        />
      ) : (
        <label className="block text-sm text-muted-foreground">
          Importe que pasa a la cuenta
          <input
            name="monto"
            required
            inputMode="decimal"
            defaultValue={saldo > 0 ? saldo.toFixed(2) : ""}
            className="tabular mt-1 block h-11 w-full rounded-lg border border-linea bg-background px-3 text-base text-foreground"
          />
        </label>
      )}

      <button
        type="submit"
        disabled={pendiente}
        className="boton-accion inline-flex h-11 items-center gap-2 rounded-lg px-4 text-base font-medium disabled:opacity-60"
      >
        {pendiente ? <Loader2 className="h-5 w-5 animate-spin" /> : <Wallet className="h-5 w-5" />}
        {modo === "cobrar" ? "Registrar cobro y emitir recibo" : "Pasar a cuenta corriente"}
      </button>

      {estado.error && (
        <p role="alert" className="estado-problema text-base font-medium">
          {estado.error}
        </p>
      )}
      {estado.ok && (
        <p role="status" className="estado-ok flex flex-wrap items-center gap-x-3 text-base font-medium">
          {estado.ok}
          {estado.receiptId && (
            <a
              href={`/api/recibos/${estado.receiptId}/pdf`}
              target="_blank"
              rel="noopener"
              className="underline underline-offset-2"
            >
              Imprimir el recibo
            </a>
          )}
        </p>
      )}
    </form>
  );
}

/**
 * Anulación por nota de crédito.
 *
 * Pide el motivo antes de hacer nada y avisa qué va a pasar: una factura
 * emitida no se borra, se anula con una nota de crédito que queda en el libro.
 * Es una operación fiscal, no un "deshacer".
 */
export function AnularComprobante({ id }: { id: string }) {
  const [estado, accion, pendiente] = useActionState(anular, inicial);
  const [abierto, setAbierto] = useState(false);

  if (!abierto) {
    return (
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className="inline-flex h-10 items-center gap-2 rounded-lg px-3 text-base font-medium text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
      >
        <Undo2 className="h-5 w-5" />
        Anular con nota de crédito
      </button>
    );
  }

  return (
    <form action={accion} className="space-y-2.5 rounded-xl border p-4">
      <input type="hidden" name="id" value={id} />

      <p className="text-base">
        Se emite una <strong>nota de crédito por el total</strong> que anula este
        comprobante. Las dos quedan en el libro IVA: una factura emitida no se
        borra.
      </p>

      <input
        name="motivo"
        required
        maxLength={300}
        placeholder="Motivo de la anulación"
        className="h-10 w-full rounded-lg border bg-background px-3 text-base"
      />

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={pendiente}
          className="inline-flex h-10 items-center gap-2 rounded-lg bg-red-700 px-4 text-base font-medium text-white transition-colors hover:bg-red-800 disabled:opacity-60"
        >
          {pendiente && <Loader2 className="h-5 w-5 animate-spin" />}
          Emitir nota de crédito
        </button>
        <button
          type="button"
          onClick={() => setAbierto(false)}
          className="inline-flex h-10 items-center rounded-lg border px-3 text-base font-medium transition-colors hover:bg-muted"
        >
          Cancelar
        </button>
      </div>

      {estado.error && (
        <p role="alert" className="text-base text-red-700">
          {estado.error}
        </p>
      )}
    </form>
  );
}
