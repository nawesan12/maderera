"use client";

import { useActionState, useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, FileText, Loader2, Send, X } from "lucide-react";
import { ConfirmarTope } from "./confirmar-tope";
import { enviarDocumento, type EstadoWhatsapp } from "./actions";
import type { DocumentoListado } from "@/lib/dal/admin/whatsapp";

const estadoInicial: EstadoWhatsapp = {};

const fecha = new Intl.DateTimeFormat("es-AR", { day: "2-digit", month: "2-digit" });

/**
 * Elegir un papel de la plataforma para mandarlo por WhatsApp.
 *
 * Son los del cliente de la conversación: presupuestos, facturas, remitos,
 * recibos, cortes y el resumen de cuenta. Es la pregunta que llega todo el
 * tiempo —«¿me pasás la factura?»— y la respuesta era bajar el PDF, buscarlo
 * en la carpeta de descargas y adjuntarlo en el teléfono.
 */
export function ElegirDocumento({
  conversacionId,
  documentos,
  ventanaAbierta,
  onCerrar,
  gratis = null,
}: {
  conversacionId: string;
  documentos: DocumentoListado[];
  ventanaAbierta: boolean;
  onCerrar: () => void;
  /** El chat del cliente en la app del teléfono (wa.me), para mandarlo gratis. */
  gratis?: string | null;
}) {
  const [estado, accion, enviando] = useActionState(enviarDocumento, estadoInicial);
  const [elegido, setElegido] = useState<string>("");
  const [tipo, id] = elegido.split(":");
  const documento = documentos.find((d) => `${d.tipo}:${d.id}` === elegido);

  // Mandado, se vuelve al campo de texto: el PDF ya está en la conversación.
  useEffect(() => {
    if (estado.ok) onCerrar();
  }, [estado.ok, onCerrar]);

  return (
    <form action={accion} className="max-h-[60%] overflow-y-auto border-t bg-muted/30 p-3">
      <input type="hidden" name="conversacionId" value={conversacionId} />
      <input type="hidden" name="tipo" value={tipo ?? ""} />
      <input type="hidden" name="id" value={id ?? ""} />

      <div className="mb-2.5 flex items-center justify-between gap-3">
        <h3 className="text-base font-medium">Mandar un documento</h3>
        <button
          type="button"
          onClick={onCerrar}
          className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          aria-label="Cerrar"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {documentos.length === 0 ? (
        <p className="rounded-lg bg-background px-3 py-2.5 text-base text-muted-foreground">
          Vinculá la conversación con la ficha del cliente para ver sus presupuestos, facturas y remitos.
        </p>
      ) : (
        <div className="space-y-2.5">
          <fieldset>
            <legend className="sr-only">Documento</legend>
            <ul className="grid gap-1.5 sm:grid-cols-2">
              {documentos.map((d) => {
                const valor = `${d.tipo}:${d.id}`;
                return (
                  <li key={valor}>
                    <label
                      className={`flex cursor-pointer items-start gap-2.5 rounded-lg border bg-background px-3 py-2 transition-colors hover:bg-muted ${
                        elegido === valor ? "border-brand-green ring-1 ring-brand-green" : ""
                      }`}
                    >
                      <input
                        type="radio"
                        name="elegido"
                        value={valor}
                        checked={elegido === valor}
                        onChange={() => setElegido(valor)}
                        className="mt-1"
                      />
                      <span className="min-w-0">
                        <span className="block truncate text-base font-medium">{d.titulo}</span>
                        <span className="tabular block text-sm text-muted-foreground">
                          {d.detalle}
                          {d.fecha ? ` · ${fecha.format(new Date(d.fecha))}` : ""}
                        </span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </fieldset>

          {ventanaAbierta ? (
            <input
              name="epigrafe"
              maxLength={1000}
              placeholder="Texto que acompaña (opcional), por ejemplo: «Te paso lo que me pediste»"
              aria-label="Texto que acompaña al documento"
              className="h-10 w-full rounded-lg border bg-background px-2.5 text-base"
            />
          ) : (
            <p className="estado-espera rounded-lg bg-[var(--estado-fondo)] px-3 py-2 text-sm text-[var(--estado-tinta)]">
              Pasaron más de 24 horas: el PDF sale pegado al mensaje preparado «documento adjunto», que Meta cobra
              como de utilidad.
            </p>
          )}

          {estado.error && (
            <p role="alert" className="estado-problema flex items-start gap-2 rounded-lg bg-[var(--estado-fondo)] px-3 py-2 text-base text-[var(--estado-tinta)]">
              <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
              {estado.error}
            </p>
          )}
          {estado.requiereConfirmacionTope && <ConfirmarTope gratis={gratis} />}
          {estado.ok && (
            <p role="status" className="flex items-center gap-2 text-base text-green-800">
              <CheckCircle2 className="h-5 w-5" />
              {estado.ok}
            </p>
          )}

          <button
            type="submit"
            disabled={enviando || !elegido}
            className="inline-flex h-11 items-center gap-2 rounded-lg bg-verde-whatsapp px-4 text-base font-medium text-white transition-colors hover:bg-brand-green/90 disabled:opacity-50"
          >
            {enviando ? <Loader2 className="h-5 w-5 animate-spin" /> : documento ? <Send className="h-5 w-5" /> : <FileText className="h-5 w-5" />}
            {documento ? `Mandar ${documento.titulo}` : "Elegí un documento"}
          </button>
        </div>
      )}
    </form>
  );
}
