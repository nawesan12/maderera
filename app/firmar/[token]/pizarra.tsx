"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { VolverAlPedido } from "./volver";
import { Check, Eraser, Loader2, TriangleAlert } from "lucide-react";
import { firmarRemito, type EstadoFirma } from "./actions";
import { revisarDocumentoDeRetiro } from "@/lib/entregas/documento";

const inicial: EstadoFirma = {};

/**
 * Firma con el dedo.
 *
 * Un `<canvas>` y eventos de puntero, sin librería: son cincuenta líneas y una
 * dependencia menos que mantener por algo que hace un trazo.
 *
 * Tres cosas que parecen detalles y no lo son:
 *
 * - **`touch-action: none`.** Sin eso, arrastrar el dedo hace scroll de la
 *   página en vez de dibujar, y la pantalla se vuelve inusable justo en el
 *   dispositivo para el que está pensada.
 * - **El canvas se dimensiona con `devicePixelRatio`.** Si no, en un celular
 *   moderno el trazo sale pixelado y la firma parece un garabato.
 * - **Se exporta con fondo blanco.** Un PNG transparente impreso sobre papel
 *   blanco se ve bien, pero mostrado en modo oscuro desaparece.
 */
export function Pizarra({
  token,
  envio = false,
  nombreSugerido,
  documentoSugerido,
}: {
  token: string;
  /** En un envío firma quien recibe, no quien retira. */
  envio?: boolean;
  nombreSugerido: string | null;
  documentoSugerido: string | null;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // El DNI cargado en el mostrador llega enmascarado: se muestra, y se
  // cambia solo si firma otra persona.
  const [cambiarDni, setCambiarDni] = useState(!documentoSugerido);
  const dibujando = useRef(false);
  const [hayTrazo, setHayTrazo] = useState(false);
  const [estado, firmar, enviando] = useActionState(firmarRemito, inicial);
  const router = useRouter();
  // El nombre de quien firma: si no es el del mostrador, el DNI enmascarado
  // es de otra persona y se pide de nuevo (mes simulado 2: la constancia
  // quedaba a nombre de Hugo con el DNI de Martín).
  const [nombre, setNombre] = useState(nombreSugerido ?? "");
  // «Juan» del mostrador y «Juan Pérez» al firmar son la misma persona.
  const antes = (nombreSugerido ?? "").trim().toLowerCase();
  const ahora = nombre.trim().toLowerCase();
  const otraPersona = Boolean(documentoSugerido) && antes !== "" && !ahora.startsWith(antes) && !antes.startsWith(ahora);
  const dniObligatorio = otraPersona || !envio;
  // Lo que falta se dice en la página, en el lugar del error: el globo del
  // navegador salía en inglés («Please fill out this field.», mes 23).
  const [aviso, setAviso] = useState<{ campo: "receptorNombre" | "receptorDocumento"; texto: string } | null>(null);

  function revisar(e: React.FormEvent<HTMLFormElement>) {
    const datos = new FormData(e.currentTarget);
    const n = String(datos.get("receptorNombre") ?? "").trim();
    const d = String(datos.get("receptorDocumento") ?? "");
    const hayCampoDni = datos.has("receptorDocumento");
    let falta: typeof aviso = null;
    if (!n) falta = { campo: "receptorNombre", texto: envio ? "Falta el nombre de quien recibe." : "Falta el nombre de quien retira." };
    else if (hayCampoDni && (dniObligatorio || d.trim() !== "")) {
      const problema = revisarDocumentoDeRetiro(d);
      if (problema) falta = { campo: "receptorDocumento", texto: envio && !d.trim() ? "Falta el DNI de quien recibe." : problema };
    }
    setAviso(falta);
    if (falta) {
      e.preventDefault();
      document.getElementById(falta.campo)?.focus();
    }
  }

  // Ya estaba firmado: la página vuelve a leerse y muestra la constancia.
  useEffect(() => {
    if (estado.yaFirmado) router.refresh();
  }, [estado.yaFirmado, router]);

  function preparar(canvas: HTMLCanvasElement) {
    const escala = window.devicePixelRatio || 1;
    const caja = canvas.getBoundingClientRect();

    if (canvas.width === Math.round(caja.width * escala)) return;

    canvas.width = Math.round(caja.width * escala);
    canvas.height = Math.round(caja.height * escala);

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.scale(escala, escala);
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#111";
  }

  function posicion(evento: React.PointerEvent<HTMLCanvasElement>) {
    const caja = evento.currentTarget.getBoundingClientRect();
    return { x: evento.clientX - caja.left, y: evento.clientY - caja.top };
  }

  function empezar(evento: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = evento.currentTarget;
    preparar(canvas);
    canvas.setPointerCapture(evento.pointerId);

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const { x, y } = posicion(evento);
    ctx.beginPath();
    ctx.moveTo(x, y);
    dibujando.current = true;
    setHayTrazo(true);
  }

  function mover(evento: React.PointerEvent<HTMLCanvasElement>) {
    if (!dibujando.current) return;

    const ctx = evento.currentTarget.getContext("2d");
    if (!ctx) return;

    const { x, y } = posicion(evento);
    ctx.lineTo(x, y);
    ctx.stroke();
  }

  function terminar() {
    dibujando.current = false;
  }

  function borrar() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHayTrazo(false);
  }

  /** Vuelca el trazo sobre fondo blanco y lo mete en el campo oculto. */
  function volcarFirma(formData: FormData) {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const plano = document.createElement("canvas");
    plano.width = canvas.width;
    plano.height = canvas.height;

    const ctx = plano.getContext("2d");
    if (!ctx) return;

    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, plano.width, plano.height);
    ctx.drawImage(canvas, 0, 0);

    formData.set("firma", plano.toDataURL("image/png"));
  }

  if (estado.numero || estado.yaFirmado) {
    return (
      <div className="p-1 text-center">
        <span className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-brand-green">
          <Check className="h-6 w-6 text-white" strokeWidth={3} />
        </span>
        <p className="text-lg font-semibold">Listo, quedó firmado</p>
        {estado.numero && (
          <p className="mt-1 text-muted-foreground">
            Guardamos la constancia del remito {estado.numero}. Te la mandamos
            por correo.
          </p>
        )}
        {/* Firmado en la tablet del mostrador, se vuelve al pedido. */}
        <VolverAlPedido />
      </div>
    );
  }

  return (
    <form
      noValidate
      onSubmit={revisar}
      action={(formData) => {
        volcarFirma(formData);
        firmar(formData);
      }}
      className="space-y-4"
    >
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="firma" value="" />

      <div>
        <label htmlFor="receptorNombre" className="block font-medium">
          {envio ? "Nombre y apellido de quien recibe" : "Nombre y apellido de quien retira"}
        </label>
        <input
          id="receptorNombre"
          name="receptorNombre"
          value={nombre}
          onChange={(e) => {
            setNombre(e.target.value);
            if (aviso?.campo === "receptorNombre") setAviso(null);
          }}
          autoComplete="name"
          required
          aria-invalid={aviso?.campo === "receptorNombre" || undefined}
          className="mt-1 h-12 w-full rounded-lg border bg-background px-3 text-base"
        />
      </div>

      {/* Llega enmascarado («•••678», entregas.RemitoPorToken): el enlace
          va por correo. Sin tocarlo se conserva el del mostrador; «Cambiar»
          es para cuando firma otra persona. La frase «escribilo solo si no
          es el tuyo» no se entendía (mes simulado). */}
      {cambiarDni || otraPersona ? (
        <div>
          <label htmlFor="receptorDocumento" className="block font-medium">
            {/* En un retiro el DNI es obligatorio, también en el remito de
                la reposición, que nace sin quien retira (mes simulado). */}
            DNI {envio && !documentoSugerido && !otraPersona && <span className="font-normal text-muted-foreground">(opcional)</span>}
          </label>
          <input
            id="receptorDocumento"
            name="receptorDocumento"
            inputMode="numeric"
            required={dniObligatorio}
            aria-invalid={aviso?.campo === "receptorDocumento" || undefined}
            onChange={() => aviso?.campo === "receptorDocumento" && setAviso(null)}
            autoFocus={cambiarDni && Boolean(documentoSugerido)}
            className="tabular mt-1 h-12 w-full rounded-lg border bg-background px-3 text-base"
          />
        </div>
      ) : (
        <div className="flex items-center justify-between gap-3">
          <p>
            <span className="font-medium">DNI</span> <span className="tabular text-muted-foreground">{documentoSugerido}</span>
          </p>
          <button
            type="button"
            onClick={() => setCambiarDni(true)}
            className="h-11 rounded-lg px-3 text-base font-medium text-muted-foreground hover:bg-hundida hover:text-foreground"
          >
            Cambiar
          </button>
        </div>
      )}

      <div>
        <div className="flex items-baseline justify-between gap-2">
          <span className="font-medium">Firmá acá abajo</span>
          <button
            type="button"
            onClick={borrar}
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <Eraser className="h-4 w-4" />
            Borrar
          </button>
        </div>

        <canvas
          ref={canvasRef}
          onPointerDown={empezar}
          onPointerMove={mover}
          onPointerUp={terminar}
          onPointerLeave={terminar}
          aria-label="Espacio para firmar con el dedo"
          className="mt-1.5 h-44 w-full touch-none rounded-lg border-2 border-dashed bg-white"
        />

        {!hayTrazo && (
          <p className="mt-1.5 text-sm text-muted-foreground">
            Usá el dedo o el mouse. Si te sale mal, borrá y hacela de nuevo.
          </p>
        )}
      </div>

      {(aviso || estado.error) && (
        <p role="alert" className="flex items-start gap-2 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          {aviso?.texto ?? estado.error}
        </p>
      )}

      <button
        type="submit"
        disabled={enviando || !hayTrazo}
        className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-accion text-base font-medium text-white transition-colors hover:bg-brand-orange-dark disabled:opacity-50"
      >
        {enviando && <Loader2 className="h-4 w-4 animate-spin" />}
        Confirmar la entrega
      </button>
    </form>
  );
}
