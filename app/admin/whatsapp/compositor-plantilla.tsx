"use client";

import { useActionState, useMemo, useState } from "react";
import { AlertCircle, CheckCircle2, Loader2, Send, Smartphone, X } from "lucide-react";
import { enviarPlantilla, type EstadoWhatsapp } from "./actions";
import { ConfirmarTope } from "./confirmar-tope";
import { enlaceWaMe } from "@/lib/whatsapp/aviso-manual";
import { camposFaltantes, nombreLegible, sugerirValores, vistaPrevia } from "@/lib/whatsapp/plantillas";
import type { PlantillaDisponible } from "@/lib/dal/admin/whatsapp";
import type { DocumentoListado } from "@/lib/dal/admin/whatsapp";
import { primerNombre } from "@/lib/formato";

const estadoInicial: EstadoWhatsapp = {};

/** Lo que cuesta cada categoría en Argentina (USD por mensaje entregado, tarifa del 1/10/2026). */
const COSTO: Record<string, string> = {
  UTILITY: "USD 0,026",
  MARKETING: "USD 0,062",
  AUTHENTICATION: "USD 0,026",
};

const CATEGORIA: Record<string, string> = {
  UTILITY: "de utilidad",
  MARKETING: "de promoción",
  AUTHENTICATION: "de verificación",
};

/** Cómo se llama cada dato en pantalla, para las plantillas con nombres. */
const ETIQUETAS: Record<string, string> = {
  nombre: "Nombre",
  pedido: "N.º de pedido",
  sucursal: "Sucursal",
  horario: "Horario",
  presupuesto: "N.º de presupuesto",
  total: "Total",
  vence: "Vence el",
  documento: "Qué se manda",
  importe: "Importe",
  recibo: "N.º de recibo",
  saldo: "Saldo",
  cheque: "Cheque",
  motivo: "Motivo",
  fecha: "Fecha",
  corte: "N.º de corte",
};

/**
 * Envío de una plantilla aprobada.
 *
 * Se muestra el texto final ya armado, con los datos puestos, antes de mandar.
 * Fuera de la ventana de 24 h es la única forma de escribirle a alguien, cada
 * envío se cobra, y el texto no se puede corregir después: mandar a ciegas
 * «Hola {{nombre}}» es un error caro y visible para el cliente.
 *
 * Los datos vienen precargados con lo que ya se sabe —el nombre, el pedido, la
 * sucursal, el saldo— porque tipearlos a mano es donde aparecen los errores.
 */
export function CompositorPlantilla({
  conversacionId,
  nombre,
  plantillas,
  conocidos,
  documentos,
  ventanaAbierta,
  onCerrar,
  waId = null,
}: {
  conversacionId: string;
  nombre: string;
  /** El número del cliente, para mandarlo desde el teléfono. Null si no se conoce. */
  waId?: string | null;
  plantillas: PlantillaDisponible[];
  conocidos: Record<string, string>;
  documentos: DocumentoListado[];
  ventanaAbierta: boolean;
  /** Null cuando no hay alternativa: fuera de la ventana no se puede escribir libre. */
  onCerrar: (() => void) | null;
}) {
  const [estado, accion, enviando] = useActionState(enviarPlantilla, estadoInicial);

  // La que más se usa para retomar va primero cuando la ventana está cerrada.
  const inicial =
    (!ventanaAbierta && plantillas.find((p) => p.nombre === "retomar_conversacion")?.nombre) || plantillas[0]?.nombre || "";
  const [elegida, setElegida] = useState(inicial);
  const plantilla = plantillas.find((p) => p.nombre === elegida);

  const sugeridos = useMemo(
    () => ({ nombre: nombre === "Sin identificar" ? "" : primerNombre(nombre), ...conocidos }),
    [nombre, conocidos],
  );

  // Lo que la persona corrigió a mano, por campo; el resto sale de lo sugerido.
  const [editados, setEditados] = useState<Record<string, string>>({});
  const [documento, setDocumento] = useState("");

  // Elegido el PDF, ya se sabe cómo nombrarlo en el texto.
  const descripcion = documentos.find((d) => `${d.tipo}:${d.id}` === documento)?.descripcion;
  const conDocumento = descripcion ? { ...sugeridos, documento: descripcion } : sugeridos;
  const valores = plantilla ? { ...sugerirValores(plantilla, conDocumento), ...editados } : {};
  const faltan = plantilla ? camposFaltantes(plantilla, valores) : [];
  const faltaDocumento = plantilla?.encabezadoMedia === "document" && !documento;
  const texto = plantilla ? vistaPrevia(plantilla, valores) : "";
  const gratis = waId && texto ? enlaceWaMe(`+${waId}`, texto) : null;
  const pdfs = documentos;

  return (
    <form action={accion} className="max-h-[65%] overflow-y-auto border-t bg-muted/30 p-3">
      <input type="hidden" name="conversacionId" value={conversacionId} />
      <input type="hidden" name="plantilla" value={elegida} />
      <input type="hidden" name="idioma" value={plantilla?.idioma ?? ""} />
      <input type="hidden" name="documento" value={documento} />
      {plantilla?.campos
        .filter((c) => c.marcador !== "media")
        .map((c) => <input key={c.clave} type="hidden" name={`v:${c.clave}`} value={valores[c.clave] ?? ""} />)}

      <div className="mb-2.5 flex items-center justify-between gap-3">
        <h3 className="text-base font-medium">Mensaje preparado</h3>
        {onCerrar && (
          <button
            type="button"
            onClick={onCerrar}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label="Volver a escribir libremente"
          >
            <X className="h-5 w-5" />
          </button>
        )}
      </div>

      {!ventanaAbierta && (
        <p className="estado-espera mb-2.5 rounded-lg bg-[var(--estado-fondo)] px-3 py-2 text-sm text-[var(--estado-tinta)]">
          Pasaron más de 24 horas desde su último mensaje: WhatsApp solo deja mandar un mensaje preparado. Cuando
          conteste, se vuelve a poder escribir libremente.
        </p>
      )}

      {plantillas.length === 0 ? (
        <p className="estado-espera rounded-lg bg-[var(--estado-fondo)] px-3 py-2.5 text-base text-[var(--estado-tinta)]">
          No hay mensajes preparados aprobados todavía. Hay que cargarlos en Meta, esperar la aprobación y
          sincronizarlos desde la configuración.
        </p>
      ) : (
        <div className="space-y-2.5">
          <select
            value={elegida}
            onChange={(e) => {
              setElegida(e.target.value);
              setEditados({});
              setDocumento("");
            }}
            className="h-10 w-full rounded-lg border bg-background px-2.5 text-base"
            aria-label="Elegir el mensaje preparado"
          >
            {plantillas.map((p) => (
              <option key={`${p.nombre}-${p.idioma}`} value={p.nombre}>
                {nombreLegible(p.nombre)}
                {p.uso ? ` — ${p.uso}` : ""}
              </option>
            ))}
          </select>

          {plantilla?.categoria && (
            <p className="text-sm text-muted-foreground">
              Mensaje {CATEGORIA[plantilla.categoria] ?? plantilla.categoria.toLowerCase()}: Meta cobra{" "}
              {COSTO[plantilla.categoria] ?? "según la categoría"} por cada uno que se entrega.
            </p>
          )}

          {plantilla && plantilla.campos.some((c) => c.marcador !== "media") && (
            <div className="grid gap-2 sm:grid-cols-2">
              {plantilla.campos
                .filter((c) => c.marcador !== "media")
                .map((c) => {
                  const etiqueta = ETIQUETAS[c.marcador] ?? (c.donde === "boton" ? "Enlace del botón" : `Dato ${c.marcador}`);
                  return (
                    <label key={c.clave} className="block">
                      <span className="text-sm text-muted-foreground">{etiqueta}</span>
                      <input
                        value={valores[c.clave] ?? ""}
                        onChange={(e) => setEditados((previos) => ({ ...previos, [c.clave]: e.target.value }))}
                        placeholder={c.ejemplo ?? ""}
                        maxLength={200}
                        className={`mt-0.5 h-10 w-full rounded-lg border bg-background px-2.5 text-base ${
                          faltan.some((f) => f.clave === c.clave) ? "border-[var(--estado-tinta)]" : ""
                        }`}
                      />
                    </label>
                  );
                })}
            </div>
          )}

          {plantilla?.encabezadoMedia === "document" && (
            <label className="block">
              <span className="text-sm text-muted-foreground">Documento que va pegado</span>
              <select
                value={documento}
                onChange={(e) => setDocumento(e.target.value)}
                className="mt-0.5 h-10 w-full rounded-lg border bg-background px-2.5 text-base"
              >
                <option value="">{pdfs.length ? "Elegí el PDF" : "La conversación no tiene ficha: no hay documentos"}</option>
                {pdfs.map((d) => (
                  <option key={`${d.tipo}:${d.id}`} value={`${d.tipo}:${d.id}`}>
                    {d.titulo} — {d.detalle}
                  </option>
                ))}
              </select>
            </label>
          )}

          <p className="whitespace-pre-wrap rounded-lg bg-brand-green/10 px-3.5 py-2.5 text-base" aria-label="Así lo va a leer">
            {texto}
          </p>

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

          {/* Desde la app del teléfono no hay ventana de 24 h ni plantilla que
              aprobar, y no se cobra: el mismo texto, gratis. */}
          {gratis && !estado.requiereConfirmacionTope && (
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
              Por la API se cobra.
              <a
                href={gratis}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 font-medium text-brand-green hover:underline"
              >
                <Smartphone className="h-4 w-4" />
                Mandarlo desde el teléfono (gratis)
              </a>
            </p>
          )}

          <button
            type="submit"
            disabled={enviando || faltan.length > 0 || faltaDocumento || !plantilla}
            className="inline-flex h-11 items-center gap-2 rounded-lg bg-verde-whatsapp px-4 text-base font-medium text-white transition-colors hover:bg-brand-green/90 disabled:opacity-50"
          >
            {enviando ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
            {faltan.length > 0 ? "Faltan datos" : faltaDocumento ? "Elegí el documento" : "Enviar mensaje preparado"}
          </button>
        </div>
      )}
    </form>
  );
}
