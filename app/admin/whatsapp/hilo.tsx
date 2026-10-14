"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  AlertCircle,
  ArrowLeft,
  BellOff,
  Check,
  CheckCheck,
  CheckCircle2,
  Clock,
  FileText,
  FlaskConical,
  Loader2,
  MapPin,
  Paperclip,
  Reply,
  RotateCw,
  Send,
  Smartphone,
  SquarePen,
  Undo2,
  UserRound,
  X,
} from "lucide-react";
import {
  asignarConversacion,
  cambiarEstadoConversacion,
  reaccionar,
  reintentarDescarga,
  reintentarMensaje,
  responder,
  simularEntrante,
  type EstadoWhatsapp,
} from "./actions";
import { etiquetaDia, horaMensaje, jidCorto } from "./formato-wa";
import { CompositorPlantilla } from "./compositor-plantilla";
import { ElegirDocumento } from "./elegir-documento";
import type { Persona } from "./bandeja";
import type { DetalleConversacion, MensajeDeLaBandeja } from "@/lib/dal/admin/whatsapp";
import type { PlantillaDisponible } from "@/lib/whatsapp/catalogo";
import { restanteLegible } from "@/lib/whatsapp/ventana";

const estadoInicial: EstadoWhatsapp = {};

/** Las reacciones que se usan de verdad para contestar sin escribir. */
const REACCIONES = ["👍", "✅", "🙏", "❤️"];

interface Citado {
  waMessageId: string;
  cuerpo: string;
}

export function Hilo({
  detalle,
  plantillas,
  personal,
  usuarioId,
  modoDemo,
  alto = "max-h-[calc(100vh-16rem)] min-h-[32rem]",
}: {
  detalle: DetalleConversacion;
  plantillas: PlantillaDisponible[];
  personal: Persona[];
  usuarioId: string;
  modoDemo: boolean;
  /** Clases de alto: cambian entre el panel y el puesto de atención. */
  alto?: string;
}) {
  const pathname = usePathname();
  const parametros = useSearchParams();

  const [estado, accionResponder, enviando] = useActionState(responder, estadoInicial);
  /**
   * Qué compositor se muestra. «auto» deja que lo decida la ventana y el
   * último envío: fuera de las 24 h, o si Meta rechazó por eso, aparece el
   * selector de plantillas solo, en lugar de dejar a la persona con un error
   * y sin salida.
   */
  const [modo, setModo] = useState<"auto" | "texto" | "plantilla" | "documento">("auto");
  const [citado, setCitado] = useState<Citado | null>(null);

  const ventanaAbierta = detalle.ventanaAbierta;
  const conPlantilla =
    modo === "plantilla" || (modo === "auto" && (!ventanaAbierta || Boolean(estado.requierePlantilla)));

  const finRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const campoRef = useRef<HTMLTextAreaElement>(null);

  // Al abrir y al llegar un mensaje nuevo, al final: lo último dicho es lo
  // que se está por contestar.
  useEffect(() => {
    finRef.current?.scrollIntoView({ block: "end" });
  }, [detalle.mensajes.length]);

  // Después de mandar, el campo queda vacío y con el foco: contestar tres
  // cosas seguidas es lo normal. Si falló, lo escrito se queda.
  useEffect(() => {
    if (!enviando && !estado.error) formRef.current?.reset();
  }, [enviando, estado.error]);

  function volverALista() {
    const nuevos = new URLSearchParams(parametros.toString());
    nuevos.delete("chat");
    return `${pathname}?${nuevos.toString()}`;
  }

  function citar(m: MensajeDeLaBandeja) {
    if (!m.waMessageId) return;
    setCitado({ waMessageId: m.waMessageId, cuerpo: m.cuerpo || (m.mediaTipo ? "Archivo" : "Mensaje") });
    setModo("texto");
    campoRef.current?.focus();
  }

  const restante = restanteLegible(detalle.ultimoEntranteAt);

  return (
    <section className={`tarjeta flex flex-col overflow-hidden ${alto}`}>
      {/* Cabecera */}
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b px-4 py-3">
        <Link
          href={volverALista()}
          className="-ml-1 inline-flex h-10 w-10 items-center justify-center rounded-lg transition-colors hover:bg-muted lg:hidden"
          aria-label="Volver a la lista"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>

        <div className="min-w-0 flex-1">
          {/* El `truncate` va sobre el nombre y no sobre el `h2`: puesto en el
              contenedor recortaba también la píldora. */}
          <h2 className="flex items-center gap-2 text-base font-medium">
            <span className="truncate">{detalle.nombre}</span>
            {detalle.clienteTipo === "profesional" && (
              <span className="shrink-0 rounded-full bg-naranja-claro px-2 py-0.5 text-sm font-semibold text-acento-sobre-claro">
                Profesional
              </span>
            )}
          </h2>
          <p className="tabular truncate text-sm text-muted-foreground">
            {detalle.sinNumero ? "WhatsApp no comparte su número" : jidCorto(detalle.waJid)}
            {detalle.customerId ? (
              <Link href={`/admin/clientes/${detalle.customerId}`} className="ml-2 font-sans text-brand-orange hover:underline">
                ver ficha
              </Link>
            ) : (
              <span className="ml-2 font-sans">· sin ficha de cliente</span>
            )}
          </p>
        </div>

        <Asignar
          conversacionId={detalle.id}
          asignado={detalle.asignadoAUserId}
          personal={personal}
          usuarioId={usuarioId}
        />
        <FormularioEstado conversacionId={detalle.id} estado={detalle.estado} />
      </header>

      {detalle.bajaAt && (
        <p className="flex items-center gap-2 border-b bg-muted/50 px-4 py-2 text-sm text-muted-foreground">
          <BellOff className="h-4 w-4 shrink-0" />
          Pidió no recibir avisos automáticos ({detalle.bajaDetalle ?? "sin detalle"}). Las respuestas a lo que pregunte
          salen igual.
        </p>
      )}

      {/* Mensajes */}
      <div className="flex-1 space-y-1 overflow-y-auto bg-brand-cream/25 px-4 py-4" aria-live="polite">
        {detalle.mensajes.length === 0 ? (
          <p className="py-10 text-center text-base text-muted-foreground">Todavía no hay mensajes en esta conversación.</p>
        ) : (
          detalle.mensajes.map((mensaje, i) => {
            const anterior = detalle.mensajes[i - 1];
            const cambiaDia =
              !anterior || new Date(anterior.ocurridoAt).toDateString() !== new Date(mensaje.ocurridoAt).toDateString();

            return (
              <div key={mensaje.id}>
                {cambiaDia && (
                  <p className="my-3 text-center">
                    <span className="rounded-full bg-background px-3 py-1 text-sm text-muted-foreground shadow-sm">
                      {etiquetaDia(mensaje.ocurridoAt)}
                    </span>
                  </p>
                )}
                <Burbuja mensaje={mensaje} ventanaAbierta={ventanaAbierta} onCitar={() => citar(mensaje)} />
              </div>
            );
          })
        )}
        <div ref={finRef} />
      </div>

      {/* Ventana de 24 h: se dice siempre, porque decide qué se puede mandar. */}
      {!conPlantilla && modo !== "documento" && (
        <p
          className={`flex flex-wrap items-center gap-x-2 gap-y-1 border-t px-4 py-2 text-sm ${
            ventanaAbierta ? "text-muted-foreground" : "estado-espera bg-[var(--estado-fondo)] text-[var(--estado-tinta)]"
          }`}
        >
          <Clock className="h-4 w-4 shrink-0" />
          {ventanaAbierta ? (
            <>
              Podés contestar libremente por {restante} más.
              <button type="button" onClick={() => setModo("plantilla")} className="font-medium text-brand-orange hover:underline">
                Usar un mensaje preparado
              </button>
            </>
          ) : (
            <>
              Pasaron más de 24 horas desde su último mensaje: WhatsApp solo deja mandar un mensaje preparado.
              <button type="button" onClick={() => setModo("plantilla")} className="font-medium underline">
                Elegir uno
              </button>
            </>
          )}
        </p>
      )}

      {/* Compositor */}
      {modo === "documento" ? (
        <ElegirDocumento
          conversacionId={detalle.id}
          documentos={detalle.documentos}
          ventanaAbierta={ventanaAbierta}
          onCerrar={() => setModo("auto")}
        />
      ) : conPlantilla ? (
        <CompositorPlantilla
          key={detalle.id}
          conversacionId={detalle.id}
          nombre={detalle.nombre}
          plantillas={plantillas}
          ventanaAbierta={ventanaAbierta}
          conocidos={detalle.conocidos}
          documentos={detalle.documentos}
          onCerrar={ventanaAbierta ? () => setModo("texto") : null}
        />
      ) : (
        <form
          ref={formRef}
          action={(datos) => {
            // La cita ya viajó en el formulario: se saca de la vista al mandar.
            setCitado(null);
            accionResponder(datos);
          }}
          className="border-t p-3"
        >
          <input type="hidden" name="conversacionId" value={detalle.id} />
          <input type="hidden" name="citado" value={citado?.waMessageId ?? ""} />

          {estado.error && (
            <p
              role="alert"
              className="estado-problema mb-2 flex items-start gap-2 rounded-lg bg-[var(--estado-fondo)] px-3 py-2 text-base text-[var(--estado-tinta)]"
            >
              <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
              {estado.error}
            </p>
          )}

          {citado && (
            <div className="mb-2 flex items-start gap-2 rounded-lg border-l-4 border-brand-green bg-muted/60 px-3 py-2">
              <p className="min-w-0 flex-1 truncate text-sm">
                <span className="font-medium">Respondiendo a:</span> {citado.cuerpo}
              </p>
              <button
                type="button"
                onClick={() => setCitado(null)}
                className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted"
                aria-label="No citar"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )}

          {/* El texto ocupa todo el ancho: en la columna del medio, con los
              botones al costado, quedaba de tres palabras por renglón. */}
          <div className="space-y-2">
            <textarea
              ref={campoRef}
              name="cuerpo"
              rows={2}
              required
              maxLength={4096}
              placeholder="Escribí tu respuesta…"
              aria-label="Respuesta"
              className="block min-h-[2.75rem] w-full resize-y rounded-lg border bg-background px-3 py-2.5 text-base"
              onKeyDown={(e) => {
                // Enter manda, Shift+Enter hace salto de línea: es lo que la
                // mano ya sabe hacer de usar WhatsApp todo el día.
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  e.currentTarget.form?.requestSubmit();
                }
              }}
            />
            <div className="flex items-center gap-2">
            <AdjuntarArchivo conversacionId={detalle.id} citado={citado?.waMessageId ?? null} />
            <button
              type="button"
              onClick={() => setModo("documento")}
              className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-lg border px-3 text-base transition-colors hover:bg-muted"
              title="Mandar un presupuesto, una factura, un remito, un recibo o el resumen de cuenta"
            >
              <FileText className="h-5 w-5" />
              <span className="hidden sm:inline">Documento</span>
            </button>
              <span className="flex-1" />
            <button
              type="submit"
              disabled={enviando}
              className="inline-flex h-11 items-center gap-2 rounded-lg bg-brand-green px-4 text-base font-medium text-white transition-colors hover:bg-brand-green/90 disabled:opacity-50"
            >
              {enviando ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
              Enviar
            </button>
            </div>
          </div>
        </form>
      )}

      {modoDemo && <SimuladorEntrante conversacionId={detalle.id} />}
    </section>
  );
}

/**
 * Una burbuja de mensaje.
 *
 * Lo que entra va a la izquierda en blanco; lo que sale, a la derecha en
 * verde, como en WhatsApp: quien atiende viene de usar la app todo el día y no
 * tiene que aprender otra convención para leer lo mismo.
 */
function Burbuja({
  mensaje,
  ventanaAbierta,
  onCitar,
}: {
  mensaje: MensajeDeLaBandeja;
  ventanaAbierta: boolean;
  onCitar: () => void;
}) {
  const saliente = mensaje.direccion === "saliente";
  const ubicacion = (mensaje.datos?.ubicacion ?? null) as { mapa?: string | null; nombre?: string | null } | null;
  const [pendiente, iniciar] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function reaccion(emoji: string) {
    iniciar(async () => {
      const r = await reaccionar(mensaje.id, emoji);
      setError(r.error ?? null);
    });
  }

  return (
    <div className={`group flex ${saliente ? "justify-end" : "justify-start"}`}>
      <div className={`relative max-w-[85%] sm:max-w-[75%] ${mensaje.reaccionCliente || mensaje.reaccionNuestra ? "mb-3" : ""}`}>
        <div
          className={`rounded-2xl px-3.5 py-2.5 shadow-sm ${
            mensaje.estado === "fallido"
              ? "rounded-br-sm bg-red-50 ring-1 ring-red-200"
              : saliente
                ? "rounded-br-sm bg-brand-green/15"
                : "rounded-bl-sm bg-background"
          }`}
        >
          <Procedencia mensaje={mensaje} />

          {mensaje.citado && (
            <p
              className={`mb-1.5 truncate rounded-md border-l-4 bg-black/[0.04] px-2 py-1 text-sm text-muted-foreground ${
                mensaje.citado.direccion === "saliente" ? "border-brand-green" : "border-brand-orange"
              }`}
            >
              {mensaje.citado.cuerpo}
            </p>
          )}

          <Adjunto mensaje={mensaje} />

          {mensaje.cuerpo &&
            (ubicacion?.mapa ? (
              <a
                href={ubicacion.mapa}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-start gap-1.5 text-base text-brand-orange-dark underline underline-offset-2"
              >
                <MapPin className="mt-0.5 h-5 w-5 shrink-0" />
                {mensaje.cuerpo}
              </a>
            ) : (
              <p className={`whitespace-pre-wrap break-words text-base ${mensaje.tipo === "unsupported" ? "italic text-muted-foreground" : ""}`}>
                {mensaje.cuerpo}
              </p>
            ))}

          <p className="mt-1 flex items-center justify-end gap-1 text-sm text-muted-foreground">
            <span className="tabular">{horaMensaje(mensaje.ocurridoAt)}</span>
            {saliente && <EstadoEntrega estado={mensaje.estado} />}
          </p>

          {mensaje.estado === "fallido" && <FalloDeEnvio mensaje={mensaje} />}
        </div>

        {(mensaje.reaccionCliente || mensaje.reaccionNuestra) && (
          <span
            className={`absolute -bottom-3 ${saliente ? "right-2" : "left-2"} rounded-full bg-background px-1.5 text-base shadow-sm ring-1 ring-border`}
            aria-label="Reacciones"
          >
            {mensaje.reaccionCliente}
            {mensaje.reaccionNuestra}
          </span>
        )}

        {/* Acciones sobre lo que mandó el cliente: citarlo o reaccionar. Se
            ven al pasar el mouse, y siempre con el teclado (focus-within). */}
        {!saliente && ventanaAbierta && mensaje.waMessageId && (
          <div className="mt-1 flex items-center gap-1 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100">
            <button
              type="button"
              onClick={onCitar}
              className="inline-flex h-8 items-center gap-1 rounded-lg px-2 text-sm text-muted-foreground hover:bg-muted"
            >
              <Reply className="h-4 w-4" />
              Responder
            </button>
            {REACCIONES.map((emoji) => (
              <button
                key={emoji}
                type="button"
                disabled={pendiente}
                onClick={() => reaccion(emoji)}
                aria-pressed={mensaje.reaccionNuestra === emoji}
                aria-label={`Reaccionar con ${emoji}`}
                className={`inline-flex h-8 w-8 items-center justify-center rounded-lg text-base hover:bg-muted disabled:opacity-50 ${
                  mensaje.reaccionNuestra === emoji ? "bg-muted" : ""
                }`}
              >
                {emoji}
              </button>
            ))}
            {error && <span className="text-sm text-red-700">{error}</span>}
          </div>
        )}
      </div>
    </div>
  );
}

/** De dónde salió: un aviso automático, el teléfono, alguien del equipo. */
function Procedencia({ mensaje }: { mensaje: MensajeDeLaBandeja }) {
  if (mensaje.direccion === "entrante") {
    if (mensaje.datos?.reenviado) {
      return <p className="mb-1 text-sm italic text-muted-foreground">Reenviado</p>;
    }
    return null;
  }

  const partes: React.ReactNode[] = [];
  if (mensaje.origen === "aviso") partes.push("Aviso automático");
  else if (mensaje.origen === "telefono")
    partes.push(
      <span key="tel" className="inline-flex items-center gap-1">
        <Smartphone className="h-3.5 w-3.5" /> Desde el teléfono
      </span>,
    );
  else if (mensaje.origen === "sistema") partes.push("Respuesta automática");
  else if (mensaje.enviadoPor) partes.push(mensaje.enviadoPor);
  if (mensaje.plantilla) partes.push("mensaje preparado");

  if (partes.length === 0) return null;
  return (
    <p className="mb-1 flex flex-wrap items-center gap-x-1.5 text-sm text-muted-foreground">
      {partes.map((p, i) => (
        <span key={i}>
          {i > 0 && "· "}
          {p}
        </span>
      ))}
    </p>
  );
}

function FalloDeEnvio({ mensaje }: { mensaje: MensajeDeLaBandeja }) {
  const [pendiente, iniciar] = useTransition();
  const [resultado, setResultado] = useState<EstadoWhatsapp>({});

  return (
    <div className="mt-2 border-t border-red-200 pt-2 text-sm text-red-800">
      <p className="flex items-start gap-1.5">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          {mensaje.errorDetalle ?? "No se envió."}
          {mensaje.errorCodigo ? <span className="tabular text-red-700/80"> (código {mensaje.errorCodigo})</span> : null}
        </span>
      </p>
      <button
        type="button"
        disabled={pendiente}
        onClick={() => iniciar(async () => setResultado(await reintentarMensaje(mensaje.id)))}
        className="mt-1.5 inline-flex h-9 items-center gap-1.5 rounded-lg border border-red-300 bg-white px-2.5 font-medium hover:bg-red-50 disabled:opacity-60"
      >
        {pendiente ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCw className="h-4 w-4" />}
        Reintentar
      </button>
      {resultado.error && <p className="mt-1">{resultado.error}</p>}
    </div>
  );
}

function Adjunto({ mensaje }: { mensaje: MensajeDeLaBandeja }) {
  const [pendiente, iniciar] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (!mensaje.mediaTipo) return null;

  if (mensaje.mediaEstado === "pendiente" || mensaje.mediaEstado === "fallido") {
    const fallido = mensaje.mediaEstado === "fallido";
    // Falló una vez y la cola lo reintenta sola: se dice, y se puede apurar.
    const reintentando = !fallido && Boolean(mensaje.errorDetalle);
    return (
      <div className="mb-1.5 rounded-lg border border-dashed bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
        <p className="flex items-center gap-1.5">
          {fallido ? <AlertCircle className="h-4 w-4 text-red-700" /> : <Loader2 className="h-4 w-4 animate-spin" />}
          {fallido
            ? "No se pudo bajar el archivo de WhatsApp."
            : reintentando
              ? "Todavía no se pudo bajar el archivo; se vuelve a intentar solo."
              : "Bajando el archivo…"}
        </p>
        {(fallido || reintentando) && (
          <button
            type="button"
            disabled={pendiente}
            onClick={() =>
              iniciar(async () => {
                const r = await reintentarDescarga(mensaje.id);
                setError(r.error ?? null);
              })
            }
            className="mt-1.5 inline-flex h-9 items-center gap-1.5 rounded-lg border bg-background px-2.5 font-medium text-foreground hover:bg-muted disabled:opacity-60"
          >
            {pendiente ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCw className="h-4 w-4" />}
            Volver a intentar
          </button>
        )}
        {error && <p className="mt-1 text-red-700">{error}</p>}
      </div>
    );
  }

  if (!mensaje.mediaUrl) return null;

  if (mensaje.mediaTipo === "image" || mensaje.mediaTipo === "sticker") {
    return (
      <a href={mensaje.mediaUrl} target="_blank" rel="noopener noreferrer">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={mensaje.mediaUrl}
          alt={mensaje.cuerpo || (mensaje.direccion === "entrante" ? "Imagen enviada por el cliente" : "Imagen enviada")}
          className={`mb-1.5 rounded-lg object-cover ${mensaje.mediaTipo === "sticker" ? "max-h-32" : "max-h-64"}`}
        />
      </a>
    );
  }

  if (mensaje.mediaTipo === "audio") {
    return <audio controls src={mensaje.mediaUrl} className="mb-1.5 w-64 max-w-full" />;
  }

  if (mensaje.mediaTipo === "video") {
    return <video controls src={mensaje.mediaUrl} className="mb-1.5 max-h-64 rounded-lg" />;
  }

  return (
    <a
      href={mensaje.mediaUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="mb-1.5 flex items-center gap-2 rounded-lg border bg-background px-3 py-2 text-base hover:bg-muted"
    >
      <FileText className="h-5 w-5 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate">{mensaje.mediaNombre ?? "Archivo"}</span>
      {mensaje.mediaBytes ? (
        <span className="tabular shrink-0 text-sm text-muted-foreground">{tamano(mensaje.mediaBytes)}</span>
      ) : null}
    </a>
  );
}

function tamano(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Los tildes de WhatsApp: uno enviado, dos entregado, dos azules leído. */
function EstadoEntrega({ estado }: { estado: string }) {
  if (estado === "fallido") {
    return (
      <span className="flex items-center gap-1 font-medium text-red-700">
        <AlertCircle className="h-4 w-4" />
        No se envió
      </span>
    );
  }
  if (estado === "pendiente") return <Clock className="h-4 w-4" aria-label="Enviando" />;
  if (estado === "enviado") return <Check className="h-4 w-4" aria-label="Enviado" />;

  return (
    <CheckCheck
      className={`h-4 w-4 ${estado === "leido" ? "text-blue-600" : ""}`}
      aria-label={estado === "leido" ? "Leído" : "Entregado"}
    />
  );
}

/** Mandar una foto o un archivo de la computadora. */
function AdjuntarArchivo({ conversacionId, citado }: { conversacionId: string; citado: string | null }) {
  const router = useRouter();
  const entrada = useRef<HTMLInputElement>(null);
  const [subiendo, setSubiendo] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function mandar(archivo: File) {
    setSubiendo(true);
    setError(null);
    try {
      const form = new FormData();
      form.set("conversacionId", conversacionId);
      form.set("archivo", archivo);
      if (citado) form.set("citado", citado);
      const res = await fetch("/api/whatsapp/enviar-archivo", { method: "POST", body: form });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) setError(json.error ?? "No se pudo mandar el archivo.");
      router.refresh();
    } catch {
      setError("No se pudo mandar el archivo. Revisá la conexión.");
    } finally {
      setSubiendo(false);
      if (entrada.current) entrada.current.value = "";
    }
  }

  return (
    <div className="relative">
      <input
        ref={entrada}
        type="file"
        className="sr-only"
        accept="image/jpeg,image/png,application/pdf,.doc,.docx,.xls,.xlsx,video/mp4,audio/*"
        aria-label="Elegir un archivo para mandar"
        onChange={(e) => {
          const archivo = e.target.files?.[0];
          if (archivo) void mandar(archivo);
        }}
      />
      <button
        type="button"
        disabled={subiendo}
        onClick={() => entrada.current?.click()}
        className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border transition-colors hover:bg-muted disabled:opacity-60"
        aria-label="Adjuntar una foto o un archivo"
        title="Adjuntar una foto o un archivo"
      >
        {subiendo ? <Loader2 className="h-5 w-5 animate-spin" /> : <Paperclip className="h-5 w-5" />}
      </button>
      {error && (
        <p role="alert" className="absolute bottom-full left-0 mb-2 w-72 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800 shadow ring-1 ring-red-200">
          {error}
        </p>
      )}
    </div>
  );
}

function Asignar({
  conversacionId,
  asignado,
  personal,
  usuarioId,
}: {
  conversacionId: string;
  asignado: string | null;
  personal: Persona[];
  usuarioId: string;
}) {
  const [, accion, pendiente] = useActionState(asignarConversacion, estadoInicial);
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <form ref={formRef} action={accion} className="flex items-center gap-1.5">
      <input type="hidden" name="conversacionId" value={conversacionId} />
      <label htmlFor={`asignar-${conversacionId}`} className="sr-only">
        Quién la atiende
      </label>
      {pendiente ? (
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      ) : (
        <UserRound className="h-4 w-4 text-muted-foreground" />
      )}
      <select
        id={`asignar-${conversacionId}`}
        name="usuarioId"
        defaultValue={asignado ?? ""}
        key={asignado ?? "nadie"}
        onChange={() => formRef.current?.requestSubmit()}
        className="h-10 max-w-[11rem] rounded-lg border bg-background px-2 text-base"
      >
        <option value="">Sin asignar</option>
        {personal.map((p) => (
          <option key={p.id} value={p.id}>
            {p.id === usuarioId ? `${p.nombre} (vos)` : p.nombre}
          </option>
        ))}
      </select>
    </form>
  );
}

function FormularioEstado({ conversacionId, estado }: { conversacionId: string; estado: "abierta" | "cerrada" }) {
  const [, accion, pendiente] = useActionState(cambiarEstadoConversacion, estadoInicial);
  const resuelta = estado === "cerrada";

  return (
    <form action={accion}>
      <input type="hidden" name="conversacionId" value={conversacionId} />
      <input type="hidden" name="estado" value={resuelta ? "abierta" : "cerrada"} />
      <button
        type="submit"
        disabled={pendiente}
        className="inline-flex h-10 items-center gap-1.5 rounded-lg border px-3 text-base font-medium transition-colors hover:bg-muted disabled:opacity-60"
      >
        {pendiente ? (
          <Loader2 className="h-5 w-5 animate-spin" />
        ) : resuelta ? (
          <Undo2 className="h-5 w-5" />
        ) : (
          <CheckCircle2 className="h-5 w-5 text-green-700" />
        )}
        {resuelta ? "Reabrir" : "Resuelta"}
      </button>
    </form>
  );
}

/**
 * Simulador de mensaje entrante. Solo en modo demostración.
 *
 * Inyecta el mensaje por la misma ingesta que usa el webhook (incluido el
 * «BAJA»), así lo que se ve es el comportamiento de verdad.
 */
function SimuladorEntrante({ conversacionId }: { conversacionId: string }) {
  const [estado, accion, pendiente] = useActionState(simularEntrante, estadoInicial);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (!pendiente && !estado.error) formRef.current?.reset();
  }, [pendiente, estado.error]);

  return (
    <form ref={formRef} action={accion} className="flex items-center gap-2 border-t border-dashed bg-muted/40 px-3 py-2">
      <input type="hidden" name="conversacionId" value={conversacionId} />
      <FlaskConical className="h-4 w-4 shrink-0 text-muted-foreground" />
      <input
        name="cuerpo"
        required
        maxLength={500}
        placeholder="Simular un mensaje del cliente (solo en demostración)"
        aria-label="Simular un mensaje del cliente"
        className="h-10 flex-1 rounded-lg border bg-background px-2.5 text-sm"
      />
      <button
        type="submit"
        disabled={pendiente}
        className="inline-flex h-10 items-center gap-1.5 rounded-lg border bg-background px-2.5 text-sm font-medium transition-colors hover:bg-muted disabled:opacity-60"
      >
        {pendiente ? <Loader2 className="h-4 w-4 animate-spin" /> : <SquarePen className="h-4 w-4" />}
        Simular
      </button>
    </form>
  );
}
