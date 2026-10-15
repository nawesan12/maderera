"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, CheckCircle2, Download, MessageCircle, PhoneOff } from "lucide-react";
import { registrarAvisoManual } from "@/app/admin/aviso-manual-actions";
import type { AvisoManualListo } from "@/lib/whatsapp/aviso-manual-datos";

/**
 * «Avisar por WhatsApp», gratis.
 *
 * Es un enlace de verdad a `https://wa.me/<número>?text=<mensaje>` que abre en
 * otra pestaña: en el teléfono abre la app WhatsApp Business, en la
 * computadora WhatsApp Desktop o Web, con el chat del cliente y el texto ya
 * escrito. La persona solo toca enviar, y no se le paga nada a Meta. Al
 * abrirlo queda registrado (`registrarAvisoManual`), así el botón dice «ya
 * avisado» y el automático no lo repite.
 *
 * Con `atajo`, `Alt + W` lo abre desde cualquier lugar de la pantalla (la W de
 * WhatsApp; `Alt + T` es de los avisos de la pantalla). Se pone en una sola
 * cosa por pantalla: en un tablero con veinte tarjetas no habría a cuál ir.
 */
export function AvisarPorWhatsapp({
  aviso,
  atajo = false,
  compacto = false,
}: {
  aviso: AvisoManualListo;
  atajo?: boolean;
  compacto?: boolean;
}) {
  const router = useRouter();
  const enlace = useRef<HTMLAnchorElement>(null);
  const [recien, setRecien] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, iniciar] = useTransition();

  useEffect(() => {
    if (!atajo || !aviso.href) return;
    function alApretar(e: KeyboardEvent) {
      if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || e.code !== "KeyW") return;
      // Con un diálogo abierto, los atajos de atrás no corren (Base UI marca `data-open`).
      if (document.querySelector('[role="dialog"][data-open], [role="alertdialog"][data-open]')) return;
      e.preventDefault();
      enlace.current?.click();
    }
    window.addEventListener("keydown", alApretar);
    return () => window.removeEventListener("keydown", alApretar);
  }, [atajo, aviso.href]);

  function registrar() {
    setRecien(true);
    setError(null);
    iniciar(async () => {
      const resultado = await registrarAvisoManual({
        evento: aviso.evento,
        entidadTipo: aviso.entidadTipo,
        entidadId: aviso.entidadId,
        telefono: aviso.telefono,
      });
      if (resultado.error) setError(resultado.error);
      else router.refresh();
    });
  }

  const alto = compacto ? "h-10" : "h-11";

  if (!aviso.href) {
    return (
      <div className="space-y-1.5" data-aviso-whatsapp={aviso.evento}>
        <p className="flex items-start gap-2 rounded-lg border border-dashed px-3 py-2 text-sm text-muted-foreground">
          <PhoneOff className="mt-0.5 h-4 w-4 shrink-0" />
          <span>No se puede avisar por WhatsApp: {aviso.motivo}</span>
        </p>
        {aviso.historia.length > 0 && (
          <ul className="space-y-0.5 text-sm text-muted-foreground">
            {aviso.historia.map((h) => (
              <li key={h.canal}>{h.texto}</li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  const avisado = aviso.yaAvisado || recien;

  return (
    <div className="space-y-1.5" data-aviso-whatsapp={aviso.evento}>
      <div className="flex flex-wrap items-center gap-2">
        <a
          ref={enlace}
          href={aviso.href}
          target="_blank"
          rel="noopener noreferrer"
          onClick={registrar}
          aria-keyshortcuts={atajo ? "Alt+W" : undefined}
          title={`Abre WhatsApp Business con el mensaje escrito para ${aviso.para ?? "el cliente"}. Solo tocás enviar.${atajo ? " (Alt + W)" : ""}`}
          className={`inline-flex ${alto} items-center gap-2 rounded-lg px-3.5 text-base font-medium transition-colors ${
            avisado
              ? "border text-foreground hover:bg-muted"
              : "bg-brand-green text-white hover:bg-brand-green/90"
          }`}
        >
          <MessageCircle className="h-5 w-5" />
          {avisado ? "Volver a avisar por WhatsApp" : "Avisar por WhatsApp"}
          <span className={`text-sm font-normal ${avisado ? "text-muted-foreground" : "text-white/85"}`}>gratis</span>
          {atajo && (
            <kbd className={`hidden rounded border px-1 text-xs font-normal sm:inline ${avisado ? "" : "border-white/40"}`}>
              Alt W
            </kbd>
          )}
        </a>
        {aviso.pdf && (
          <a
            href={aviso.pdf}
            target="_blank"
            rel="noopener noreferrer"
            className={`inline-flex ${alto} items-center gap-1.5 rounded-lg border px-3 text-base transition-colors hover:bg-muted`}
          >
            <Download className="h-4 w-4" />
            PDF para adjuntar
          </a>
        )}
      </div>

      {!compacto && (
        <p className="text-sm text-muted-foreground">
          A {aviso.para ?? "el cliente"} ({aviso.telefono}). Se abre WhatsApp con el mensaje escrito: solo tocás enviar.
          {aviso.pdf && " El enlace lleva solo el texto: adjuntá el PDF en el chat."}
        </p>
      )}

      <ul className="space-y-0.5 text-sm">
        {recien && !aviso.yaAvisado && (
          <li className="flex items-center gap-1.5 text-green-800">
            <CheckCircle2 className="h-4 w-4" />
            Quedó registrado que avisaste a mano.
          </li>
        )}
        {aviso.historia.map((h) => (
          <li
            key={h.canal}
            className={`flex items-start gap-1.5 ${h.atencion ? "text-[var(--estado-tinta)] estado-espera" : "text-muted-foreground"}`}
          >
            {h.atencion ? <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> : <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />}
            {h.texto}
          </li>
        ))}
        {aviso.automaticoPrendido && (
          <li className="text-muted-foreground">
            El aviso automático por la API también está prendido: ese cuesta {aviso.costoAutomatico} por mensaje; este
            botón no cuesta nada.
          </li>
        )}
        {error && (
          <li role="alert" className="text-red-700">
            {error}
          </li>
        )}
      </ul>

      {!compacto && (
        <details className="text-sm">
          <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Ver el mensaje</summary>
          <p className="mt-1 whitespace-pre-line rounded-lg bg-muted/60 px-3 py-2">{aviso.texto}</p>
        </details>
      )}
    </div>
  );
}
