"use client";

import { useEffect, useRef, useState } from "react";
import { Check, KeyRound, Loader2, X } from "lucide-react";
import { formatearMonto } from "@/lib/formato";

/** Lo que contesta Go cuando falta el PIN de un admin (internal/autorizacion). */
export interface Autorizacion {
  motivo: "precio" | "credito" | "anular" | "devolver" | "presupuesto" | "costo" | "remito";
  monto: number;
  /** Con motivo precio: lo que además pasa el límite de cuenta corriente. */
  credito?: number;
  pinIncorrecto?: boolean;
  bloqueadoHasta?: string;
  sinAdmins?: boolean;
  /** Sin ningún PIN cargado, firma la contraseña de un admin. */
  conClave?: boolean;
}

/**
 * Qué se autoriza, en el idioma del mostrador. Con el precio y el crédito a
 * la vez van las dos cifras: el admin que firma un redondeo tiene que ver
 * también la deuda que firma (autorizacion.QueSeAutoriza en Go).
 */
function queSeAutoriza(a: Autorizacion): string {
  const credito = a.credito && a.credito > 0 ? ` · ${formatearMonto(a.credito)} a cuenta, pasado el límite` : "";
  switch (a.motivo) {
    case "precio":
    case "presupuesto":
      return `${formatearMonto(a.monto)} abajo del precio${credito}`;
    case "credito":
      return `${formatearMonto(a.monto)} a cuenta, pasado el límite`;
    case "anular":
      return `Anular ${formatearMonto(a.monto)}`;
    case "devolver":
      return `Devolver ${formatearMonto(a.monto)}`;
    case "costo":
      return `${formatearMonto(a.monto)} abajo del costo${credito}`;
    case "remito":
      return "Anular un remito firmado";
  }
}

function hora(iso: string): string {
  return new Date(iso).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
}

/**
 * El PIN de un admin, en el lugar del botón (T3).
 *
 * La venta no se corta ni abre otra pantalla: aparece un solo campo con el
 * foco puesto y la cifra que se autoriza. El admin teclea y Enter (o
 * «Autorizar») reenvía lo mismo; Esc o la cruz vuelven atrás (la cruz también con el
 * campo bloqueado, que no toma el foco y no recibe el Esc). Un PIN
 * equivocado tiembla y lo dice, y bloqueado muestra hasta cuándo: que nadie
 * siga probando delante del cliente.
 */
export function CampoPin({
  autorizacion,
  enviando,
  onEnviar,
  onCancelar,
  grande = false,
}: {
  autorizacion: Autorizacion;
  enviando: boolean;
  onEnviar: (pin: string) => void;
  onCancelar: () => void;
  /** En el mostrador va a la altura del botón de cobrar. */
  grande?: boolean;
}) {
  const [pin, setPin] = useState("");
  const [tiembla, setTiembla] = useState(false);
  /** Enter con menos de seis números: tiembla y dice cuántos van. */
  const [corto, setCorto] = useState(false);
  const campo = useRef<HTMLInputElement>(null);
  const conClave = Boolean(autorizacion.conClave);
  const bloqueado =
    Boolean(autorizacion.bloqueadoHasta) || (Boolean(autorizacion.sinAdmins) && !conClave);
  const listo = conClave ? pin.length > 0 : pin.length >= 6;

  // Cada respuesta con el PIN equivocado vacía el campo y tiembla: el admin
  // está al lado, lo teclea de nuevo. (Se ajusta al renderizar, cuando llega
  // otra respuesta, y no en un efecto.)
  const [vista, setVista] = useState(autorizacion);
  if (vista !== autorizacion) {
    setVista(autorizacion);
    if (autorizacion.pinIncorrecto) {
      setPin("");
      setTiembla(true);
    }
  }
  // Mientras se manda, el campo se deshabilita y pierde el foco: vuelve.
  useEffect(() => {
    if (!enviando) campo.current?.focus();
  }, [enviando]);

  const leyenda = autorizacion.bloqueadoHasta
    ? `Bloqueado hasta las ${hora(autorizacion.bloqueadoHasta)}`
    : autorizacion.sinAdmins && !conClave
      ? "Ningún admin cargó su PIN"
      : autorizacion.pinIncorrecto
        ? conClave
          ? "Contraseña incorrecta"
          : "PIN incorrecto"
        : corto
          ? "De 6 a 8 números"
          : queSeAutoriza(autorizacion);

  function mandar() {
    if (enviando) return;
    // Corto no se manda (no gasta un intento), pero tampoco se queda mudo:
    // tiembla y dice cuántos números son.
    if (!listo) {
      if (pin.length > 0) {
        setCorto(true);
        setTiembla(true);
      }
      campo.current?.focus();
      return;
    }
    onEnviar(pin);
  }

  /*
   * En un diálogo angosto (375 px) la leyenda va en su renglón, arriba, y el
   * campo toma el ancho: al lado de «Anular un remito firmado» el campo
   * medía 58 px y los puntos no se veían. Con lugar, todo en una línea.
   * «Autorizar» está a la vista: el teclado numérico del teléfono puede no
   * tener Enter.
   */
  return (
    <div className="@container">
      <div
        className={`flex flex-wrap items-center gap-2.5 ${tiembla ? "animate-temblar" : ""}`}
        onAnimationEnd={() => setTiembla(false)}
      >
        <span
          role="status"
          className={`min-h-6 basis-full text-base font-semibold @lg:order-2 @lg:basis-auto @lg:text-right ${
            bloqueado || autorizacion.pinIncorrecto || corto ? "estado-problema" : "text-brand-orange"
          }`}
        >
          {enviando ? <Loader2 className="h-5 w-5 animate-spin" /> : leyenda}
        </span>
        <label className="relative min-w-[8rem] flex-1 @lg:order-1">
          <span className="sr-only">{conClave ? "Contraseña admin" : "PIN admin"}</span>
          <KeyRound
            className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <input
            ref={campo}
            autoFocus
            type="password"
            inputMode={conClave ? "text" : "numeric"}
            enterKeyHint="done"
            autoComplete="off"
            maxLength={conClave ? 128 : 8}
            disabled={bloqueado || enviando}
            value={pin}
            placeholder={conClave ? "Contraseña admin" : "PIN admin"}
            aria-invalid={autorizacion.pinIncorrecto || corto || undefined}
            onChange={(e) => {
              setCorto(false);
              setPin(conClave ? e.target.value : e.target.value.replace(/\D/g, ""));
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                onCancelar();
              }
              if (e.key === "Enter") {
                e.preventDefault();
                e.stopPropagation();
                mandar();
              }
            }}
            className={`tabular w-full rounded-xl border bg-hundida pl-11 pr-3 placeholder:tracking-normal disabled:opacity-60 ${conClave ? "" : "tracking-[0.4em]"} ${
              grande ? "h-16 text-2xl" : "h-12 text-lg"
            } ${autorizacion.pinIncorrecto || corto ? "border-[var(--estado-acento)] estado-problema" : "border-linea"}`}
          />
        </label>
        <button
          type="button"
          onClick={mandar}
          disabled={bloqueado || enviando || pin.length === 0}
          className={`boton-accion inline-flex shrink-0 items-center justify-center gap-1.5 rounded-xl px-4 text-base font-semibold disabled:opacity-50 @lg:order-3 ${
            grande ? "h-16" : "h-12"
          }`}
        >
          <Check className="h-5 w-5" aria-hidden="true" />
          Autorizar
        </button>
        <button
          type="button"
          onClick={onCancelar}
          aria-label="Volver"
          className={`inline-flex shrink-0 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-hundida hover:text-foreground @lg:order-4 ${
            grande ? "h-16 w-16" : "h-12 w-12"
          }`}
        >
          <X className="h-5 w-5" />
        </button>
      </div>
    </div>
  );
}
