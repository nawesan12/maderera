"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import {
  AlertCircle,
  Archive,
  ArrowLeft,
  Check,
  CheckCheck,
  Clock,
  FileText,
  FlaskConical,
  Loader2,
  Send,
  SquarePen,
  Undo2,
} from "lucide-react";
import {
  cambiarEstadoConversacion,
  responder,
  simularEntrante,
  type EstadoWhatsapp,
} from "./actions";
import { etiquetaDia, horaMensaje, horasDeVentana, jidCorto } from "./formato-wa";
import { CompositorPlantilla } from "./compositor-plantilla";
import type { PlantillaAprobada } from "@/lib/whatsapp/tipos";
import type { obtenerConversacion } from "@/lib/dal/admin/whatsapp";

type Detalle = NonNullable<Awaited<ReturnType<typeof obtenerConversacion>>>;
type Mensaje = Detalle["mensajes"][number];

const estadoInicial: EstadoWhatsapp = {};

export function Hilo({
  detalle,
  plantillas,
  modoDemo,
  alto = "max-h-[calc(100vh-16rem)] min-h-[32rem]",
}: {
  detalle: Detalle;
  plantillas: PlantillaAprobada[];
  modoDemo: boolean;
  /** Clases de alto: cambian entre el panel y el puesto de atención. */
  alto?: string;
}) {
  const pathname = usePathname();
  const parametros = useSearchParams();

  const [estado, accionResponder, enviando] = useActionState(
    responder,
    estadoInicial,
  );
  /**
   * Qué compositor se muestra.
   *
   * "auto" deja que lo decida el resultado del último envío: si Meta rechazó
   * el mensaje por la ventana de 24 h, aparece el selector de plantillas solo,
   * en lugar de dejar a la persona con un error y sin salida. Es un valor
   * derivado y no un efecto que llame a setState, que además de sobrar
   * provocaba un render en cascada.
   */
  const [modo, setModo] = useState<"auto" | "texto" | "plantilla">("auto");

  const conPlantilla =
    modo === "plantilla" ||
    (modo === "auto" && Boolean(estado.requierePlantilla));

  const finRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const ventanaAbierta = detalle.ventanaAbierta;
  const horasRestantes = horasDeVentana(detalle.ultimoEntranteAt);

  // Al abrir la conversación y al llegar un mensaje nuevo, se baja al final:
  // lo último dicho es lo que se está por contestar.
  useEffect(() => {
    finRef.current?.scrollIntoView({ block: "end" });
  }, [detalle.mensajes.length]);

  // Después de mandar, el campo queda vacío y con el foco puesto para seguir
  // escribiendo: contestar tres cosas seguidas es lo normal.
  useEffect(() => {
    if (!enviando && !estado.error) formRef.current?.reset();
  }, [enviando, estado.error]);

  function volverALista() {
    const nuevos = new URLSearchParams(parametros.toString());
    nuevos.delete("chat");
    return `${pathname}?${nuevos.toString()}`;
  }

  return (
    <section className={`tarjeta flex flex-col overflow-hidden ${alto}`}>
      {/* Cabecera */}
      <header className="flex items-center gap-3 border-b px-4 py-3">
        <Link
          href={volverALista()}
          className="-ml-1 inline-flex h-10 w-10 items-center justify-center rounded-lg transition-colors hover:bg-muted lg:hidden"
          aria-label="Volver a la lista"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>

        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-medium">
            {detalle.nombre}
            {detalle.clienteTipo === "profesional" && (
              <span className="ml-2 rounded-full bg-brand-orange/12 px-2 py-0.5 text-sm font-semibold text-brand-orange-dark">
                Profesional
              </span>
            )}
          </h2>
          <p className="tabular truncate text-sm text-muted-foreground">
            {jidCorto(detalle.waJid)}
            {detalle.customerId ? (
              <Link
                href={`/admin/clientes/${detalle.customerId}`}
                className="ml-2 font-sans text-brand-orange hover:underline"
              >
                ver ficha
              </Link>
            ) : (
              <span className="ml-2 font-sans">· sin ficha de cliente</span>
            )}
          </p>
        </div>

        <FormularioEstado
          conversacionId={detalle.id}
          estado={detalle.estado}
        />
      </header>

      {/* Mensajes */}
      <div className="flex-1 space-y-1 overflow-y-auto bg-brand-cream/25 px-4 py-4">
        {detalle.mensajes.length === 0 ? (
          <p className="py-10 text-center text-base text-muted-foreground">
            Todavía no hay mensajes en esta conversación.
          </p>
        ) : (
          detalle.mensajes.map((mensaje, i) => {
            const anterior = detalle.mensajes[i - 1];
            const cambiaDia =
              !anterior ||
              new Date(anterior.ocurridoAt).toDateString() !==
                new Date(mensaje.ocurridoAt).toDateString();

            return (
              <div key={mensaje.id}>
                {cambiaDia && (
                  <p className="my-3 text-center">
                    <span className="rounded-full bg-background px-3 py-1 text-sm text-muted-foreground shadow-sm">
                      {etiquetaDia(mensaje.ocurridoAt)}
                    </span>
                  </p>
                )}
                <Burbuja mensaje={mensaje} />
              </div>
            );
          })
        )}
        <div ref={finRef} />
      </div>

      {/* Ventana de 24 h */}
      {!conPlantilla && (
        <p
          className={`flex flex-wrap items-center gap-x-2 gap-y-1 border-t px-4 py-2 text-sm ${
            ventanaAbierta
              ? "text-muted-foreground"
              : "bg-amber-50 text-amber-900"
          }`}
        >
          <Clock className="h-4 w-4 shrink-0" />
          {ventanaAbierta ? (
            <>
              Podés contestar libremente por {horasRestantes} h más.
              <button
                type="button"
                onClick={() => setModo("plantilla")}
                className="font-medium text-brand-orange hover:underline"
              >
                Usar un mensaje preparado
              </button>
            </>
          ) : (
            <>
              Pasaron más de 24 horas desde su último mensaje: WhatsApp solo
              deja enviar uno de los textos aprobados.
              <button
                type="button"
                onClick={() => setModo("plantilla")}
                className="font-medium underline"
              >
                Elegir uno
              </button>
            </>
          )}
        </p>
      )}

      {/* Compositor */}
      {conPlantilla ? (
        <CompositorPlantilla
          conversacionId={detalle.id}
          nombre={detalle.nombre}
          plantillas={plantillas}
          pedidoNumero={detalle.pedidos[0]?.numero ?? ""}
          sucursal={detalle.pedidos[0]?.sucursal ?? ""}
          onCerrar={() => setModo("texto")}
        />
      ) : (
        <form
          ref={formRef}
          action={accionResponder}
          className="border-t p-3"
        >
          <input type="hidden" name="conversacionId" value={detalle.id} />

          {estado.error && (
            <p
              role="alert"
              className="mb-2 flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-base text-red-800"
            >
              <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
              {estado.error}
            </p>
          )}

          <div className="flex items-end gap-2">
            <textarea
              name="cuerpo"
              rows={2}
              required
              maxLength={4000}
              disabled={!ventanaAbierta}
              placeholder={
                ventanaAbierta
                  ? "Escribí tu respuesta…"
                  : "Fuera de la ventana de 24 horas"
              }
              className="min-h-[2.75rem] flex-1 resize-y rounded-lg border bg-background px-3 py-2.5 text-base disabled:bg-muted disabled:text-muted-foreground"
              onKeyDown={(e) => {
                // Enter manda, Shift+Enter hace salto de línea: es lo que la
                // mano ya sabe hacer de usar WhatsApp todo el día.
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  e.currentTarget.form?.requestSubmit();
                }
              }}
            />
            <button
              type="submit"
              disabled={enviando || !ventanaAbierta}
              className="inline-flex h-11 items-center gap-2 rounded-lg bg-brand-green px-4 text-base font-medium text-white transition-colors hover:bg-brand-green/90 disabled:opacity-50"
            >
              {enviando ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <Send className="h-5 w-5" />
              )}
              Enviar
            </button>
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
 * Lo que entra va a la izquierda en blanco; lo que sale, a la derecha en verde,
 * como en WhatsApp. No es capricho: quien atiende viene de usar la app todo el
 * día y no tiene que aprender otra convención para leer lo mismo.
 */
function Burbuja({ mensaje }: { mensaje: Mensaje }) {
  const saliente = mensaje.direccion === "saliente";

  return (
    <div className={`flex ${saliente ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 shadow-sm sm:max-w-[75%] ${
          saliente
            ? "rounded-br-sm bg-brand-green/15"
            : "rounded-bl-sm bg-background"
        }`}
      >
        {mensaje.plantilla && (
          <p className="mb-1 flex items-center gap-1.5 text-sm text-muted-foreground">
            <FileText className="h-3.5 w-3.5" />
            Mensaje preparado
          </p>
        )}

        {mensaje.mediaUrl && <Adjunto mensaje={mensaje} />}

        {mensaje.cuerpo && (
          <p className="whitespace-pre-wrap break-words text-base">
            {mensaje.cuerpo}
          </p>
        )}

        <p className="mt-1 flex items-center justify-end gap-1 text-sm text-muted-foreground">
          <span className="tabular">{horaMensaje(mensaje.ocurridoAt)}</span>
          {saliente && <EstadoEntrega estado={mensaje.estado} />}
        </p>
      </div>
    </div>
  );
}

function Adjunto({ mensaje }: { mensaje: Mensaje }) {
  if (!mensaje.mediaUrl) return null;

  if (mensaje.mediaTipo === "image" || mensaje.mediaTipo === "sticker") {
    return (
      <a href={mensaje.mediaUrl} target="_blank" rel="noopener noreferrer">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={mensaje.mediaUrl}
          alt={mensaje.cuerpo || "Imagen enviada por el cliente"}
          className="mb-1.5 max-h-64 rounded-lg object-cover"
        />
      </a>
    );
  }

  if (mensaje.mediaTipo === "audio") {
    // eslint-disable-next-line jsx-a11y/media-has-caption
    return <audio controls src={mensaje.mediaUrl} className="mb-1.5 w-64" />;
  }

  if (mensaje.mediaTipo === "video") {
    // eslint-disable-next-line jsx-a11y/media-has-caption
    return (
      <video controls src={mensaje.mediaUrl} className="mb-1.5 max-h-64 rounded-lg" />
    );
  }

  return (
    <a
      href={mensaje.mediaUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="mb-1.5 flex items-center gap-2 rounded-lg border bg-background px-3 py-2 text-base hover:bg-muted"
    >
      <FileText className="h-5 w-5 shrink-0 text-muted-foreground" />
      <span className="truncate">{mensaje.mediaNombre ?? "Archivo"}</span>
    </a>
  );
}

/** Los tildes de WhatsApp: uno enviado, dos entregado, dos azules leído. */
function EstadoEntrega({ estado }: { estado: string }) {
  if (estado === "fallido") {
    return (
      <span className="flex items-center gap-1 text-red-700">
        <AlertCircle className="h-4 w-4" />
        No se envió
      </span>
    );
  }

  if (estado === "pendiente") return <Clock className="h-4 w-4" />;
  if (estado === "enviado") return <Check className="h-4 w-4" />;

  return (
    <CheckCheck
      className={`h-4 w-4 ${estado === "leido" ? "text-blue-600" : ""}`}
      aria-label={estado === "leido" ? "Leído" : "Entregado"}
    />
  );
}

function FormularioEstado({
  conversacionId,
  estado,
}: {
  conversacionId: string;
  estado: "abierta" | "cerrada";
}) {
  const [, accion, pendiente] = useActionState(
    cambiarEstadoConversacion,
    estadoInicial,
  );
  const cerrada = estado === "cerrada";

  return (
    <form action={accion}>
      <input type="hidden" name="conversacionId" value={conversacionId} />
      <input
        type="hidden"
        name="estado"
        value={cerrada ? "abierta" : "cerrada"}
      />
      <button
        type="submit"
        disabled={pendiente}
        className="inline-flex h-10 items-center gap-1.5 rounded-lg px-3 text-base text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-60"
      >
        {pendiente ? (
          <Loader2 className="h-5 w-5 animate-spin" />
        ) : cerrada ? (
          <Undo2 className="h-5 w-5" />
        ) : (
          <Archive className="h-5 w-5" />
        )}
        <span className="hidden sm:inline">
          {cerrada ? "Reabrir" : "Archivar"}
        </span>
      </button>
    </form>
  );
}

/**
 * Simulador de mensaje entrante. Solo aparece en modo demostración.
 *
 * Sin número dado de alta en Meta no hay entrantes reales, y una bandeja donde
 * nunca entra nada no se puede probar. Esto inyecta el mensaje por el mismo
 * camino que usaría el webhook, así lo que se ve es el comportamiento de
 * verdad.
 */
function SimuladorEntrante({ conversacionId }: { conversacionId: string }) {
  const [estado, accion, pendiente] = useActionState(
    simularEntrante,
    estadoInicial,
  );
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (!pendiente && !estado.error) formRef.current?.reset();
  }, [pendiente, estado.error]);

  return (
    <form
      ref={formRef}
      action={accion}
      className="flex items-center gap-2 border-t border-dashed bg-muted/40 px-3 py-2"
    >
      <input type="hidden" name="conversacionId" value={conversacionId} />
      <FlaskConical className="h-4 w-4 shrink-0 text-muted-foreground" />
      <input
        name="cuerpo"
        required
        maxLength={500}
        placeholder="Simular un mensaje del cliente (solo en demostración)"
        className="h-9 flex-1 rounded-lg border bg-background px-2.5 text-sm"
      />
      <button
        type="submit"
        disabled={pendiente}
        className="inline-flex h-9 items-center gap-1.5 rounded-lg border bg-background px-2.5 text-sm font-medium transition-colors hover:bg-muted disabled:opacity-60"
      >
        {pendiente ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <SquarePen className="h-4 w-4" />
        )}
        Simular
      </button>
    </form>
  );
}
