"use client";

import { useActionState, useState } from "react";
import { Check, Loader2, Pencil, X } from "lucide-react";
import {
  cambiarAviso,
  guardarTextoAviso,
  type EstadoAviso,
} from "./acciones";

const estadoInicial: EstadoAviso = {};

export interface AvisoConfigurable {
  id: string;
  evento: string;
  plantilla: string;
  textoLibre: string | null;
  activo: boolean;
}

const TITULOS: Record<string, { titulo: string; cuando: string }> = {
  preparando: {
    titulo: "Cuando se empieza a preparar",
    cuando: "Apenas alguien mueve el pedido a Preparando.",
  },
  listo: {
    titulo: "Cuando queda listo",
    cuando: "El aviso que más consultas evita: el cliente sabe cuándo venir.",
  },
  "en-camino": {
    titulo: "Cuando sale el flete",
    cuando: "Solo en pedidos con envío.",
  },
  entregado: {
    titulo: "Cuando se entrega",
    cuando: "Cierra el círculo y deja la conversación abierta por si hay algo.",
  },
};

/**
 * Un aviso automático, con su interruptor y su texto.
 *
 * El interruptor es lo primero que se ve porque es la decisión: prenderlo hace
 * que a partir de ese momento se le escriba a todos los clientes que lleguen a
 * ese estado.
 */
export function FilaAviso({ aviso }: { aviso: AvisoConfigurable }) {
  const [estadoCambio, accionCambio, cambiando] = useActionState(
    cambiarAviso,
    estadoInicial,
  );
  const [estadoTexto, accionTexto, guardando] = useActionState(
    guardarTextoAviso,
    estadoInicial,
  );
  const [editando, setEditando] = useState(false);

  const info = TITULOS[aviso.evento] ?? {
    titulo: aviso.evento,
    cuando: "",
  };

  return (
    <li className={aviso.activo ? "tarjeta p-5" : "tarjeta-hundida p-5"}>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="min-w-[14rem] flex-1">
          <h3 className="text-base font-medium">{info.titulo}</h3>
          {info.cuando && (
            <p className="mt-0.5 text-base text-muted-foreground">
              {info.cuando}
            </p>
          )}
          <p className="mt-1.5 text-sm text-muted-foreground">
            Plantilla en Meta:{" "}
            <span className="tabular">{aviso.plantilla}</span>
          </p>
        </div>

        <form action={accionCambio}>
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
            className={`inline-flex h-10 items-center gap-2 rounded-lg px-4 text-base font-medium transition-colors disabled:opacity-60 ${
              aviso.activo
                ? "bg-brand-green text-white hover:bg-brand-green/90"
                : "border hover:bg-muted"
            }`}
          >
            {cambiando ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : aviso.activo ? (
              <Check className="h-5 w-5" />
            ) : null}
            {aviso.activo ? "Activo" : "Activar"}
          </button>
        </form>
      </div>

      {/* Texto que se manda si la conversación está abierta */}
      <div className="mt-4 border-t pt-3.5">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-sm font-semibold uppercase tracking-[0.08em] text-muted-foreground">
            Si contestó hace menos de 24 h
          </p>
          {!editando && (
            <button
              type="button"
              onClick={() => setEditando(true)}
              className="inline-flex items-center gap-1.5 text-base text-muted-foreground transition-colors hover:text-foreground"
            >
              <Pencil className="h-4 w-4" />
              Editar
            </button>
          )}
        </div>

        {editando ? (
          <form action={accionTexto} className="mt-2 space-y-2">
            <input type="hidden" name="id" value={aviso.id} />
            <textarea
              name="textoLibre"
              rows={3}
              maxLength={1000}
              defaultValue={aviso.textoLibre ?? ""}
              className="w-full rounded-lg border bg-background px-3 py-2.5 text-base"
            />
            <p className="text-sm text-muted-foreground">
              Se reemplazan {"{{1}}"} por el nombre, {"{{2}}"} por el número de
              pedido y {"{{3}}"} por la sucursal.
            </p>
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={guardando}
                className="inline-flex h-10 items-center gap-2 rounded-lg bg-brand-orange px-4 text-base font-medium text-white transition-colors hover:bg-brand-orange-dark disabled:opacity-60"
              >
                {guardando && <Loader2 className="h-5 w-5 animate-spin" />}
                Guardar
              </button>
              <button
                type="button"
                onClick={() => setEditando(false)}
                className="inline-flex h-10 items-center gap-1.5 rounded-lg border px-3 text-base font-medium transition-colors hover:bg-muted"
              >
                <X className="h-5 w-5" />
                Cancelar
              </button>
            </div>
          </form>
        ) : (
          <p className="mt-1.5 text-base">
            {aviso.textoLibre || (
              <span className="text-muted-foreground">
                Sin texto: siempre se manda la plantilla aprobada.
              </span>
            )}
          </p>
        )}

        {(estadoCambio.error || estadoTexto.error) && (
          <p role="alert" className="mt-2 text-base text-red-700">
            {estadoCambio.error ?? estadoTexto.error}
          </p>
        )}
      </div>
    </li>
  );
}
