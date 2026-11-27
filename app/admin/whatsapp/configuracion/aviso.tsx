"use client";

import { useActionState, useState, useTransition } from "react";
import { Loader2, Pencil, X } from "lucide-react";
import { Switch } from "@/components/ui/switch";
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
  titulo: string;
  cuando: string;
  /** Si la plantilla está aprobada en Meta: sin eso, fuera de la ventana no sale. */
  plantillaAprobada: boolean;
  /** Los datos que se pueden usar en el texto: {{nombre}}, {{pedido}}… */
  datos: string[];
}

/**
 * Un aviso automático, con su interruptor y su texto.
 *
 * El interruptor es lo primero que se ve porque es la decisión: prenderlo hace
 * que a partir de ese momento se le escriba a todos los clientes que lleguen a
 * ese estado.
 */
export function FilaAviso({ aviso }: { aviso: AvisoConfigurable }) {
  const [estadoCambio, setEstadoCambio] = useState<EstadoAviso>(estadoInicial);
  const [cambiando, empezar] = useTransition();
  const [activo, setActivo] = useState(aviso.activo);
  const [editando, setEditando] = useState(false);
  // Guardado bien, el editor se cierra (M3S1-011: quedaba abierto, como si
  // no hubiera guardado).
  const [estadoTexto, accionTexto, guardando] = useActionState(
    async (previo: EstadoAviso, datos: FormData) => {
      const r = await guardarTextoAviso(previo, datos);
      if (r.ok) setEditando(false);
      return r;
    },
    estadoInicial,
  );

  // Un interruptor con su estado (M2S3-063): el botón decía «Activo», que es
  // un estado, donde va la acción.
  function cambiar(v: boolean) {
    setActivo(v);
    empezar(async () => {
      const datos = new FormData();
      datos.set("id", aviso.id);
      datos.set("activo", v ? "si" : "no");
      const r = await cambiarAviso(estadoInicial, datos);
      setEstadoCambio(r);
      if (r.error) setActivo(!v);
    });
  }

  const info = { titulo: aviso.titulo, cuando: aviso.cuando };

  return (
    <li className={activo ? "tarjeta p-5" : "tarjeta-hundida p-5"}>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="min-w-[14rem] flex-1">
          <h3 className="text-base font-medium">{info.titulo}</h3>
          {info.cuando && (
            <p className="mt-0.5 text-base text-muted-foreground">
              {info.cuando}
            </p>
          )}
          <p className="mt-1.5 text-sm text-muted-foreground">
            Plantilla en Meta: <span className="tabular">{aviso.plantilla}</span>{" "}
            {aviso.plantillaAprobada ? (
              <span className="estado-ok rounded bg-[var(--estado-fondo)] px-1.5 py-0.5 text-[var(--estado-tinta)]">aprobada</span>
            ) : (
              <span className="estado-espera rounded bg-[var(--estado-fondo)] px-1.5 py-0.5 text-[var(--estado-tinta)]">
                sin aprobar: fuera de las 24 h no sale
              </span>
            )}
          </p>
        </div>

        <label className="flex shrink-0 cursor-pointer items-center gap-3">
          {cambiando && <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden="true" />}
          <span className={`text-base font-medium ${activo ? "" : "text-muted-foreground"}`}>
            {activo ? "Prendido" : "Apagado"}
          </span>
          <Switch checked={activo} onCheckedChange={cambiar} disabled={cambiando} aria-label={info.titulo} />
        </label>
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
              aria-invalid={estadoTexto.error ? true : undefined}
              aria-describedby={estadoTexto.error ? `error-aviso-${aviso.id}` : undefined}
              className="w-full rounded-lg border bg-background px-3 py-2.5 text-base aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/30"
            />
            {estadoTexto.error && (
              <p id={`error-aviso-${aviso.id}`} role="alert" className="text-base text-saldo-debe">
                {estadoTexto.error}
              </p>
            )}
            <p className="text-sm text-muted-foreground">
              Datos que se completan solos: {aviso.datos.map((d) => `{{${d}}}`).join(", ")}.
            </p>
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={guardando}
                className="inline-flex h-10 items-center gap-2 rounded-lg bg-accion px-4 text-base font-medium text-white transition-colors hover:bg-brand-orange-dark disabled:opacity-60"
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

        {estadoCambio.error && (
          <p role="alert" className="mt-2 text-base text-saldo-debe">
            {estadoCambio.error}
          </p>
        )}
      </div>
    </li>
  );
}
