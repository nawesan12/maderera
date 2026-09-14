"use client";

import { useActionState, useState } from "react";
import { Loader2, Lock, RotateCcw, Trash2, Unlock } from "lucide-react";
import { Confirmar } from "@/components/admin/confirmar";
import {
  borrarDocumento,
  cambiarVisibilidad,
  restaurarDocumento,
  type EstadoDocumento,
} from "./actions";

const inicial: EstadoDocumento = {};

/** Cambiar quién ve el documento, o darlo de baja. */
export function AccionesDocumento({
  id,
  titulo,
  soloProfesionales,
}: {
  id: string;
  titulo: string;
  soloProfesionales: boolean;
}) {
  const [, cambiar, cambiando] = useActionState(cambiarVisibilidad, inicial);
  const [estadoBaja, borrar, borrando] = useActionState(
    borrarDocumento,
    inicial,
  );
  const [confirmando, setConfirmando] = useState(false);

  return (
    <div className="flex flex-col items-end gap-1.5">
      <div className="flex items-center gap-2">
        <form action={cambiar}>
          <input type="hidden" name="id" value={id} />
          <input
            type="hidden"
            name="soloProfesionales"
            value={soloProfesionales ? "no" : "si"}
          />
          <button
            type="submit"
            disabled={cambiando}
            className="inline-flex h-11 items-center gap-1.5 rounded-lg border px-3.5 text-base font-medium transition-colors hover:bg-muted disabled:opacity-60"
          >
            {cambiando ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : soloProfesionales ? (
              <Unlock className="h-4 w-4" />
            ) : (
              <Lock className="h-4 w-4" />
            )}
            {soloProfesionales ? "Hacer público" : "Reservar"}
          </button>
        </form>

        {/* Con texto y no solo el tacho: el ícono suelto era un blanco de 32
            píxeles cuyo único nombre vivía en el `aria-label`. */}
        <form
          action={borrar}
          onSubmit={(e) => {
            if (!confirmando) {
              e.preventDefault();
              setConfirmando(true);
            }
          }}
          id={`baja-${id}`}
        >
          <input type="hidden" name="id" value={id} />
          <button
            type="submit"
            disabled={borrando}
            className="inline-flex h-11 items-center gap-1.5 rounded-lg px-3.5 text-base font-medium text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-60"
          >
            {borrando ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="h-4 w-4" />
            )}
            Dar de baja
          </button>
        </form>
      </div>

      {estadoBaja.error && (
        <p className="estado-problema text-right text-base font-medium">
          {estadoBaja.error}
        </p>
      )}

      <Confirmar
        abierto={confirmando}
        alCerrar={() => setConfirmando(false)}
        titulo={`Dar de baja «${titulo}»`}
        detalle="Deja de aparecer en el sitio. El archivo sigue existiendo y se puede volver a poner en línea desde la lista de dados de baja."
        confirmar="Sí, darlo de baja"
        peligro
        pendiente={borrando}
        alConfirmar={() => {
          setConfirmando(false);
          (
            document.getElementById(`baja-${id}`) as HTMLFormElement | null
          )?.requestSubmit();
        }}
      />
    </div>
  );
}

/** Volver a poner en línea un documento dado de baja. */
export function RestaurarDocumento({ id }: { id: string }) {
  const [estado, restaurar, restaurando] = useActionState(
    restaurarDocumento,
    inicial,
  );

  return (
    <form action={restaurar} className="flex items-center gap-2">
      <input type="hidden" name="id" value={id} />
      {estado.error && (
        <span className="estado-problema text-base font-medium">
          {estado.error}
        </span>
      )}
      <button
        type="submit"
        disabled={restaurando}
        className="inline-flex h-11 items-center gap-1.5 rounded-lg border border-linea px-3.5 text-base font-medium transition-colors hover:bg-muted disabled:opacity-60"
      >
        {restaurando ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <RotateCcw className="h-4 w-4" />
        )}
        Volver a publicar
      </button>
    </form>
  );
}
