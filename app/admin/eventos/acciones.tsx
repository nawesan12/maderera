"use client";

import { useActionState } from "react";
import { BellRing, Loader2 } from "lucide-react";
import {
  cambiarEstadoEvento,
  mandarRecordatorios,
  type EstadoEvento,
} from "./actions";

const inicial: EstadoEvento = {};

/**
 * Publicar, cerrar o cancelar un evento.
 *
 * Solo aparecen las transiciones que tienen sentido desde el estado actual:
 * ofrecer "publicar" sobre algo ya publicado es cómo se pierde la confianza en
 * los botones de una pantalla.
 */
export function AccionesEvento({
  id,
  estado,
}: {
  id: string;
  estado: string;
}) {
  const [resultado, cambiar, cambiando] = useActionState(
    cambiarEstadoEvento,
    inicial,
  );

  const opciones: { valor: string; texto: string; principal?: boolean }[] =
    estado === "borrador"
      ? [{ valor: "publicado", texto: "Publicar", principal: true }]
      : estado === "publicado"
        ? [
            { valor: "cerrado", texto: "Cerrar inscripciones" },
            { valor: "borrador", texto: "Despublicar" },
          ]
        : estado === "cerrado"
          ? [{ valor: "publicado", texto: "Reabrir" }]
          : [];

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {opciones.map((opcion) => (
        <form key={opcion.valor} action={cambiar}>
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="estado" value={opcion.valor} />
          <button
            type="submit"
            disabled={cambiando}
            className={`inline-flex h-10 items-center gap-2 rounded-lg px-3.5 text-base font-medium transition-colors disabled:opacity-60 ${
              opcion.principal
                ? "bg-brand-orange text-white hover:bg-brand-orange-dark"
                : "border hover:bg-muted"
            }`}
          >
            {cambiando && <Loader2 className="h-4 w-4 animate-spin" />}
            {opcion.texto}
          </button>
        </form>
      ))}

      {resultado.ok && (
        <p className="w-full text-right text-base text-muted-foreground">
          {resultado.ok}
        </p>
      )}
      {resultado.error && (
        <p className="w-full text-right text-base text-destructive">
          {resultado.error}
        </p>
      )}
    </div>
  );
}

/** Dispara los recordatorios de los eventos de mañana. */
export function Recordatorios() {
  const [estado, mandar, mandando] = useActionState(
    mandarRecordatorios,
    inicial,
  );

  return (
    <form action={mandar} className="flex items-center gap-3">
      {estado.ok && (
        <span className="text-base text-muted-foreground">{estado.ok}</span>
      )}
      <button
        type="submit"
        disabled={mandando}
        className="inline-flex h-10 items-center gap-2 rounded-lg border px-3.5 text-base font-medium transition-colors hover:bg-muted disabled:opacity-60"
      >
        {mandando ? (
          <Loader2 className="h-5 w-5 animate-spin" />
        ) : (
          <BellRing className="h-5 w-5" />
        )}
        Recordar los de mañana
      </button>
    </form>
  );
}
