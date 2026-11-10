"use client";

import { useState, useTransition } from "react";
import { Check, Copy, KeyRound, Loader2, MessageCircle } from "lucide-react";
import { linkDeAcceso } from "./actions";
import { enlaceWaMe } from "@/lib/whatsapp/aviso-manual";

/**
 * El link de acceso de un profesional aprobado que no tiene clave: se genera
 * uno nuevo cada vez (la base guarda solo su huella) y se copia o se manda
 * por WhatsApp con el mensaje escrito.
 */
export function LinkDeAcceso({ id }: { id: string }) {
  const [link, setLink] = useState<{ url: string; nombre: string; telefono: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);
  const [pendiente, empezar] = useTransition();

  if (!link) {
    return (
      <div className="flex flex-col items-end gap-1">
        <button
          type="button"
          disabled={pendiente}
          onClick={() =>
            empezar(async () => {
              const r = await linkDeAcceso(id);
              if (r.url && r.nombre !== undefined && r.telefono !== undefined) setLink({ url: r.url, nombre: r.nombre, telefono: r.telefono });
              else setError(r.error ?? "No se pudo generar el link.");
            })
          }
          className="inline-flex h-10 items-center gap-2 rounded-lg border px-3.5 text-base font-medium transition-colors hover:bg-muted disabled:opacity-60"
        >
          {pendiente ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
          Link de acceso
        </button>
        {error && <p className="max-w-[18rem] text-right text-sm text-muted-foreground">{error}</p>}
      </div>
    );
  }

  const mensaje = `Hola ${link.nombre.split(" ")[0]}! Ya tenés tu cuenta profesional en Maderera Juan B. Justo. Entrá con este link (sirve una vez): ${link.url}`;
  return (
    <div className="flex flex-wrap justify-end gap-2">
      <button
        type="button"
        onClick={() => {
          void navigator.clipboard.writeText(link.url);
          setCopiado(true);
        }}
        className="inline-flex h-10 items-center gap-2 rounded-lg border px-3.5 text-base font-medium transition-colors hover:bg-muted"
      >
        {copiado ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
        {copiado ? "Copiado" : "Copiar link"}
      </button>
      <a
        href={enlaceWaMe(link.telefono, mensaje) ?? undefined}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex h-10 items-center gap-2 rounded-lg bg-verde-whatsapp px-3.5 text-base font-medium text-white"
      >
        <MessageCircle className="h-4 w-4" />
        Mandar por WhatsApp
      </a>
    </div>
  );
}
