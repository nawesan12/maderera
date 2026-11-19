"use client";

import { useEffect, useRef, useState } from "react";
import { KeyRound, Loader2 } from "lucide-react";
import { formatearMonto } from "@/lib/formato";

/** Lo que contesta Go cuando falta el PIN de un admin (internal/autorizacion). */
export interface Autorizacion {
  motivo: "precio" | "credito" | "anular" | "presupuesto";
  monto: number;
  pinIncorrecto?: boolean;
  bloqueadoHasta?: string;
  sinAdmins?: boolean;
}

/** Qué se autoriza, en el idioma del mostrador. */
function queSeAutoriza(a: Autorizacion): string {
  switch (a.motivo) {
    case "precio":
    case "presupuesto":
      return `${formatearMonto(a.monto)} abajo del precio`;
    case "credito":
      return `${formatearMonto(a.monto)} a cuenta, pasado el límite`;
    case "anular":
      return `Anular ${formatearMonto(a.monto)}`;
  }
}

function hora(iso: string): string {
  return new Date(iso).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
}

/**
 * El PIN de un admin, en el lugar del botón (T3).
 *
 * La venta no se corta ni abre otra pantalla: aparece un solo campo con el
 * foco puesto y, al lado, la cifra que se autoriza. El admin teclea y Enter
 * reenvía lo mismo; Esc vuelve atrás. Un PIN equivocado tiembla y lo dice, y
 * bloqueado muestra hasta cuándo: que nadie siga probando delante del
 * cliente.
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
  const campo = useRef<HTMLInputElement>(null);
  const bloqueado = Boolean(autorizacion.bloqueadoHasta) || Boolean(autorizacion.sinAdmins);

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

  const leyenda = autorizacion.sinAdmins
    ? "Ningún admin cargó su PIN"
    : autorizacion.bloqueadoHasta
      ? `Bloqueado hasta las ${hora(autorizacion.bloqueadoHasta)}`
      : autorizacion.pinIncorrecto
        ? "PIN incorrecto"
        : queSeAutoriza(autorizacion);

  return (
    <div
      className={`flex items-center gap-2.5 ${tiembla ? "animate-temblar" : ""}`}
      onAnimationEnd={() => setTiembla(false)}
    >
      <label className="relative min-w-0 flex-1">
        <span className="sr-only">PIN admin</span>
        <KeyRound
          className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <input
          ref={campo}
          autoFocus
          type="password"
          inputMode="numeric"
          autoComplete="off"
          maxLength={8}
          disabled={bloqueado || enviando}
          value={pin}
          placeholder="PIN admin"
          aria-invalid={autorizacion.pinIncorrecto || undefined}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              onCancelar();
            }
            if (e.key === "Enter" && pin.length >= 6 && !enviando) {
              e.preventDefault();
              e.stopPropagation();
              onEnviar(pin);
            }
          }}
          className={`tabular w-full rounded-xl border bg-hundida pl-11 pr-3 tracking-[0.4em] placeholder:tracking-normal disabled:opacity-60 ${
            grande ? "h-16 text-2xl" : "h-12 text-lg"
          } ${autorizacion.pinIncorrecto ? "border-[var(--estado-acento)] estado-problema" : "border-linea"}`}
        />
      </label>
      <span
        role="status"
        className={`shrink-0 text-right text-base font-semibold ${
          bloqueado || autorizacion.pinIncorrecto ? "estado-problema" : "text-brand-orange"
        }`}
      >
        {enviando ? <Loader2 className="h-5 w-5 animate-spin" /> : leyenda}
      </span>
    </div>
  );
}
