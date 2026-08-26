"use client";

import { useActionState, useRef, useState } from "react";
import { Check, Eraser, Loader2, TriangleAlert } from "lucide-react";
import { firmarRemito, type EstadoFirma } from "./actions";

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
  nombreSugerido,
}: {
  token: string;
  nombreSugerido: string | null;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const dibujando = useRef(false);
  const [hayTrazo, setHayTrazo] = useState(false);
  const [estado, firmar, enviando] = useActionState(firmarRemito, inicial);

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

  if (estado.numero) {
    return (
      <div className="rounded-xl border border-brand-green/30 bg-brand-green/5 p-6 text-center">
        <span className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-brand-green">
          <Check className="h-6 w-6 text-white" strokeWidth={3} />
        </span>
        <p className="text-lg font-semibold">Listo, quedó firmado</p>
        <p className="mt-1 text-muted-foreground">
          Guardamos la constancia del remito {estado.numero}. Te la mandamos
          por correo.
        </p>
      </div>
    );
  }

  return (
    <form
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
          Nombre y apellido de quien retira
        </label>
        <input
          id="receptorNombre"
          name="receptorNombre"
          defaultValue={nombreSugerido ?? ""}
          autoComplete="name"
          required
          className="mt-1 h-12 w-full rounded-lg border bg-background px-3 text-base"
        />
      </div>

      <div>
        <label htmlFor="receptorDocumento" className="block font-medium">
          DNI <span className="font-normal text-muted-foreground">(opcional)</span>
        </label>
        <input
          id="receptorDocumento"
          name="receptorDocumento"
          inputMode="numeric"
          className="tabular mt-1 h-12 w-full rounded-lg border bg-background px-3 text-base"
        />
      </div>

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

      {estado.error && (
        <p className="flex items-start gap-2 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          {estado.error}
        </p>
      )}

      <button
        type="submit"
        disabled={enviando || !hayTrazo}
        className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-brand-orange text-base font-medium text-white transition-colors hover:bg-brand-orange-dark disabled:opacity-50"
      >
        {enviando && <Loader2 className="h-4 w-4 animate-spin" />}
        Confirmar la entrega
      </button>
    </form>
  );
}
