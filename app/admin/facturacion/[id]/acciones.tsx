"use client";

import { useActionState, useState } from "react";
import { AlertCircle, Check, Loader2, Send, Undo2, Wallet } from "lucide-react";
import {
  anular,
  autorizar,
  registrarCobro,
  type EstadoFactura,
} from "../actions";

const inicial: EstadoFactura = {};

const MEDIOS = [
  { valor: "efectivo", texto: "Efectivo" },
  { valor: "transferencia", texto: "Transferencia" },
  { valor: "mercado_pago", texto: "Mercado Pago" },
  { valor: "tarjeta", texto: "Tarjeta" },
  { valor: "cheque", texto: "Cheque" },
  { valor: "cuenta_corriente", texto: "Cuenta corriente" },
];

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

/** Cobro parcial o total. */
export function FormularioCobro({ id, saldo }: { id: string; saldo: number }) {
  const [estado, accion, pendiente] = useActionState(registrarCobro, inicial);

  return (
    <form action={accion} className="space-y-3">
      <input type="hidden" name="id" value={id} />

      <div className="grid gap-2 sm:grid-cols-2">
        <div>
          <label
            htmlFor="monto"
            className="mb-1 block text-sm text-muted-foreground"
          >
            Importe
          </label>
          <input
            id="monto"
            name="monto"
            required
            inputMode="decimal"
            defaultValue={saldo > 0 ? saldo.toFixed(2) : ""}
            className="tabular h-10 w-full rounded-lg border bg-background px-3 text-base"
          />
        </div>
        <div>
          <label
            htmlFor="medio"
            className="mb-1 block text-sm text-muted-foreground"
          >
            Medio
          </label>
          <select
            id="medio"
            name="medio"
            className="h-10 w-full rounded-lg border bg-background px-2.5 text-base"
          >
            {MEDIOS.map((m) => (
              <option key={m.valor} value={m.valor}>
                {m.texto}
              </option>
            ))}
          </select>
        </div>
      </div>

      <input
        name="referencia"
        placeholder="Referencia (número de operación, cheque…)"
        className="h-10 w-full rounded-lg border bg-background px-3 text-base"
      />

      <button
        type="submit"
        disabled={pendiente}
        className="inline-flex h-10 items-center gap-2 rounded-lg border px-4 text-base font-medium transition-colors hover:bg-muted disabled:opacity-60"
      >
        {pendiente ? (
          <Loader2 className="h-5 w-5 animate-spin" />
        ) : (
          <Wallet className="h-5 w-5" />
        )}
        Registrar cobro
      </button>

      {estado.error && (
        <p role="alert" className="text-base text-red-700">
          {estado.error}
        </p>
      )}
      {estado.ok && (
        <p role="status" className="text-base text-green-700">
          {estado.ok}
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
