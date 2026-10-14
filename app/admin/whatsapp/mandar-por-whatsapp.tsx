"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { CheckCircle2, Loader2, MessageCircle, Send, X } from "lucide-react";
import { enviarDocumentoAlCliente, type EstadoWhatsapp } from "./actions";

const inicial: EstadoWhatsapp & { conversacionId?: string } = {};

/**
 * «Mandarlo por WhatsApp» desde la pantalla del papel.
 *
 * El remito, el presupuesto, la factura o el resumen se mandan desde donde se
 * los está mirando, sin ir a buscar la conversación: al teléfono de la ficha
 * (o al que se escriba). Sale por la misma puerta que desde la bandeja, así
 * que respeta la ventana de 24 h y queda en la conversación del cliente.
 */
export function MandarPorWhatsapp({
  tipo,
  id,
  compacto = false,
}: {
  tipo: "presupuesto" | "comprobante" | "remito" | "recibo" | "cuenta" | "corte";
  id: string;
  compacto?: boolean;
}) {
  const [abierto, setAbierto] = useState(false);
  const [estado, accion, pendiente] = useActionState(enviarDocumentoAlCliente, inicial);
  const alto = compacto ? "h-9" : "h-10";

  if (!abierto) {
    return (
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className={`inline-flex ${alto} items-center gap-1.5 rounded-lg border px-3 text-base font-medium transition-colors hover:bg-muted`}
      >
        <MessageCircle className="h-4 w-4 text-brand-green" />
        Por WhatsApp
      </button>
    );
  }

  return (
    <form action={accion} className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/40 p-2">
      <input type="hidden" name="tipo" value={tipo} />
      <input type="hidden" name="id" value={id} />
      <label className="sr-only" htmlFor={`wa-${tipo}-${id}`}>
        Teléfono (si no, el de la ficha)
      </label>
      <input
        id={`wa-${tipo}-${id}`}
        name="telefono"
        inputMode="tel"
        placeholder="El de la ficha, u otro"
        className={`${alto} w-48 rounded-lg border bg-background px-2.5 text-base`}
      />
      <button
        type="submit"
        disabled={pendiente}
        className={`inline-flex ${alto} items-center gap-1.5 rounded-lg bg-brand-green px-3 text-base font-medium text-white hover:bg-brand-green/90 disabled:opacity-60`}
      >
        {pendiente ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        Mandar
      </button>
      <button
        type="button"
        onClick={() => setAbierto(false)}
        className={`inline-flex ${alto} w-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted`}
        aria-label="Cancelar"
      >
        <X className="h-4 w-4" />
      </button>
      {estado.error && (
        <p role="alert" className="w-full text-base text-red-700">
          {estado.error}
        </p>
      )}
      {estado.ok && (
        <p role="status" className="flex w-full items-center gap-1.5 text-base text-green-800">
          <CheckCircle2 className="h-4 w-4" />
          {estado.ok}
          {estado.conversacionId && (
            <Link href={`/admin/whatsapp?chat=${estado.conversacionId}`} className="font-medium underline">
              Ver la conversación
            </Link>
          )}
        </p>
      )}
    </form>
  );
}
