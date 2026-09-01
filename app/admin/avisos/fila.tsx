"use client";

import { useActionState, useState } from "react";
import { Check, Loader2, Pencil, X } from "lucide-react";
import {
  cambiarAvisoEmail,
  guardarTextoAvisoEmail,
  type EstadoAvisoEmail,
} from "./acciones";
import { TITULOS_EVENTO } from "@/lib/notificaciones/titulos";
import type { AvisoEmailConfigurable } from "@/lib/dal/admin/avisos";

const inicial: EstadoAvisoEmail = {};

/**
 * Un aviso por correo, con su interruptor y su asunto.
 *
 * El interruptor va primero porque es la decisión: apagarlo significa que a
 * partir de ahí ese aviso deja de salir para todos los clientes. El asunto se
 * edita en línea porque es lo único que el negocio va a querer retocar, y
 * mandarlo a otra pantalla para cambiar seis palabras no tiene sentido.
 */
export function FilaAvisoEmail({ aviso }: { aviso: AvisoEmailConfigurable }) {
  const [estadoCambio, cambiar, cambiando] = useActionState(
    cambiarAvisoEmail,
    inicial,
  );
  const [estadoTexto, guardar, guardando] = useActionState(
    guardarTextoAvisoEmail,
    inicial,
  );
  const [editando, setEditando] = useState(false);

  const titulo = TITULOS_EVENTO[aviso.evento] ?? {
    titulo: aviso.evento,
    cuando: "",
  };

  return (
    <li className="px-5 py-4">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-[16rem] flex-1">
          <p className="text-base font-medium">{titulo.titulo}</p>
          {titulo.cuando && (
            <p className="text-base text-muted-foreground">{titulo.cuando}</p>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setEditando((v) => !v)}
            className="inline-flex h-10 items-center gap-1.5 rounded-lg border px-3 text-base font-medium transition-colors hover:bg-muted"
          >
            {editando ? (
              <X className="h-4 w-4" />
            ) : (
              <Pencil className="h-4 w-4" />
            )}
            {editando ? "Cerrar" : "Asunto"}
          </button>

          <form action={cambiar}>
            <input type="hidden" name="id" value={aviso.id} />
            <input
              type="hidden"
              name="activo"
              value={aviso.activo ? "no" : "si"}
            />
            <button
              type="submit"
              disabled={cambiando}
              aria-pressed={aviso.activo}
              className={`inline-flex h-10 min-w-[6.5rem] items-center justify-center gap-1.5 rounded-lg px-3 text-base font-medium transition-colors disabled:opacity-60 ${
                aviso.activo
                  ? "bg-brand-green text-white hover:bg-brand-green/90"
                  : "border hover:bg-muted"
              }`}
            >
              {cambiando ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : aviso.activo ? (
                <Check className="h-4 w-4" />
              ) : null}
              {aviso.activo ? "Activo" : "Apagado"}
            </button>
          </form>
        </div>
      </div>

      {!editando && (
        <p className="mt-1.5 text-base text-muted-foreground">
          Asunto: <span className="text-foreground">{aviso.asunto}</span>
        </p>
      )}

      {editando && (
        <form action={guardar} className="mt-3 grid gap-3 sm:grid-cols-2">
          <input type="hidden" name="id" value={aviso.id} />

          <div>
            <label
              htmlFor={`asunto-${aviso.id}`}
              className="block text-base font-medium"
            >
              Asunto
            </label>
            <input
              id={`asunto-${aviso.id}`}
              name="asunto"
              defaultValue={aviso.asunto}
              className="mt-1 h-10 w-full rounded-lg border bg-background px-3 text-base"
            />
          </div>

          <div>
            <label
              htmlFor={`encabezado-${aviso.id}`}
              className="block text-base font-medium"
            >
              Título dentro del correo
            </label>
            <input
              id={`encabezado-${aviso.id}`}
              name="encabezado"
              defaultValue={aviso.encabezado ?? ""}
              placeholder="Si se deja vacío usa el que trae la plantilla"
              className="mt-1 h-10 w-full rounded-lg border bg-background px-3 text-base"
            />
          </div>

          <div className="flex items-center gap-3 sm:col-span-2">
            <button
              type="submit"
              disabled={guardando}
              className="inline-flex h-10 items-center gap-2 rounded-lg bg-brand-orange px-4 text-base font-medium text-white transition-colors hover:bg-brand-orange-dark disabled:opacity-60"
            >
              {guardando && <Loader2 className="h-4 w-4 animate-spin" />}
              Guardar
            </button>

            {estadoTexto.error && (
              <span className="text-base text-destructive">
                {estadoTexto.error}
              </span>
            )}
            {estadoTexto.ok && (
              <span className="text-base text-muted-foreground">
                {estadoTexto.ok}
              </span>
            )}
          </div>
        </form>
      )}

      {estadoCambio.error && (
        <p className="mt-1.5 text-base text-destructive">
          {estadoCambio.error}
        </p>
      )}
    </li>
  );
}
