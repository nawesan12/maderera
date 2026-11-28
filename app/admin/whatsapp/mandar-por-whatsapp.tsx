"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, MessageCircle, Send, X } from "lucide-react";
import { enviarDocumentoAlCliente, type EstadoWhatsapp } from "./actions";
import { ConfirmarTope } from "./confirmar-tope";

const inicial: EstadoWhatsapp & { conversacionId?: string } = {};

/**
 * «Mandarlo por WhatsApp» desde la pantalla del papel.
 *
 * El remito, el presupuesto, la factura o el resumen se mandan desde donde se
 * los está mirando, sin ir a buscar la conversación: al teléfono de la ficha
 * (o al que se escriba). Sale por la misma puerta que desde la bandeja, así
 * que respeta la ventana de 24 h y queda en la conversación del cliente.
 *
 * **Este se cobra** (la Cloud API de Meta, desde el 1/10/2026 también dentro
 * de las 24 h); por eso dice «se cobra», y al lado está el gratis
 * (`components/admin/avisar-por-whatsapp.tsx`), que lo manda una persona desde
 * la app del teléfono. Con el tope del mes pasado pide confirmar.
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
  const router = useRouter();
  // Mandado, el formulario se cierra: la constancia queda en el aviso y en
  // el papel (M4-034: seguían el campo, «Mandar» y la cruz, y la constancia
  // dos veces).
  const [vista, setVista] = useState(estado);
  if (vista !== estado) {
    setVista(estado);
    if (estado.ok) setAbierto(false);
  }
  useEffect(() => {
    if (!estado.ok) return;
    const chat = estado.conversacionId;
    toast.success(estado.ok, chat ? { action: { label: "Ver la conversación", onClick: () => router.push(`/admin/whatsapp?chat=${chat}`) } } : undefined);
  }, [estado, router]);

  if (!abierto) {
    return (
      <button
        type="button"
        onClick={() => setAbierto(true)}
        // Sale por la Cloud API de Meta con el PDF pegado, y Meta lo cobra. «Avisar por WhatsApp» lo manda desde el teléfono, gratis.
        className={`inline-flex ${alto} items-center gap-1.5 rounded-lg border px-3 text-base font-medium transition-colors hover:bg-muted`}
      >
        <MessageCircle className="h-4 w-4 text-brand-green" />
        {/* «PDF por la API» era jerga (mes simulado): sale por WhatsApp con
            el PDF adjunto, desde el sistema, y eso se cobra. */}
        WhatsApp con el PDF
        <span className="text-sm font-normal text-muted-foreground">se cobra</span>
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
        // Su renglón entero en el teléfono: al lado de «Mandar» y la cruz el
        // texto de ayuda quedaba «El de la ficha, u…» (mes simulado).
        className={`${alto} min-w-0 basis-full rounded-lg border bg-background px-2.5 text-base sm:basis-56 sm:flex-1`}
      />
      <button
        type="submit"
        disabled={pendiente}
        className={`inline-flex ${alto} items-center gap-1.5 rounded-lg bg-verde-whatsapp px-3 text-base font-medium text-white hover:bg-brand-green/90 disabled:opacity-60`}
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
        <p role="alert" className="w-full text-base text-saldo-debe">
          {estado.error}
        </p>
      )}
      {estado.requiereConfirmacionTope && (
        <div className="w-full">
          <ConfirmarTope />
        </div>
      )}
    </form>
  );
}
