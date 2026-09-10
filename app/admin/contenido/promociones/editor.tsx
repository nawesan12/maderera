"use client";

import { useActionState, useId, useState, useTransition } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { borrarPromo, guardarPromo, type EstadoPromo } from "./actions";

const inicial: EstadoPromo = {};

export interface PromoEditable {
  id: string;
  medio: string;
  titulo: string;
  detalle: string;
  dias: string;
  /** "2026-10-22", como lo espera el input de fecha. Vacía es sin vencimiento. */
  vigenciaHasta: string;
  orden: number;
  activo: boolean;
  /** Si hoy está efectivamente publicada, contando la vigencia. */
  alAire: boolean;
}

export function EditorDePromo({ promo }: { promo: PromoEditable | null }) {
  const [estado, guardar, guardando] = useActionState(guardarPromo, inicial);
  const [borrando, empezarBorrado] = useTransition();
  const [avisoBorrado, setAvisoBorrado] = useState<string | null>(null);
  const id = useId();

  return (
    <form action={guardar} className="space-y-4 rounded-xl border bg-card p-5">
      {promo && <input type="hidden" name="id" value={promo.id} />}

      <div className="grid gap-4 sm:grid-cols-2">
        <Campo
          nombre="medio"
          etiqueta="Con qué se paga"
          valorInicial={promo?.medio ?? ""}
          placeholder="Banco Nación"
          requerido
        />
        <Campo
          nombre="titulo"
          etiqueta="El beneficio, en una línea"
          valorInicial={promo?.titulo ?? ""}
          placeholder="12 cuotas sin interés"
          requerido
        />
      </div>

      <div>
        <label htmlFor={`${id}-detalle`} className="block text-base font-medium">
          La letra chica
        </label>
        <textarea
          id={`${id}-detalle`}
          name="detalle"
          rows={2}
          defaultValue={promo?.detalle ?? ""}
          placeholder="Sólo pagando con MODO BNA. Tope de reintegro $15.000."
          className="mt-1 w-full rounded-lg border bg-background px-3 py-2 text-base"
        />
        <p className="mt-1 text-sm text-muted-foreground">
          Condiciones, topes, qué tarjetas entran. Sale tal cual en el sitio.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Campo
          nombre="dias"
          etiqueta="Qué días corre"
          valorInicial={promo?.dias ?? ""}
          placeholder="Todos los días"
        />
        <Campo
          nombre="vigenciaHasta"
          etiqueta="Vigente hasta"
          tipo="date"
          valorInicial={promo?.vigenciaHasta ?? ""}
          ayuda="Vacía es «hasta nuevo aviso». Con fecha, se apaga sola."
        />
        <Campo
          nombre="orden"
          etiqueta="Orden"
          valorInicial={String(promo?.orden ?? 0)}
        />
      </div>

      <label className="flex items-center gap-2.5 text-base">
        <input
          type="checkbox"
          name="activo"
          defaultChecked={promo?.activo ?? true}
          className="h-4 w-4 accent-brand-orange"
        />
        Encendida
        {promo && !promo.alAire && promo.activo && (
          <span className="text-sm text-muted-foreground">
            · hoy no se ve: la vigencia ya pasó
          </span>
        )}
      </label>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={guardando}
          className="inline-flex h-10 items-center gap-2 rounded-lg bg-brand-orange px-4 text-base font-medium text-white transition-colors hover:bg-brand-orange-dark disabled:opacity-60"
        >
          {guardando && <Loader2 className="h-4 w-4 animate-spin" />}
          {promo ? "Guardar" : "Crear promoción"}
        </button>

        {promo && (
          <button
            type="button"
            disabled={borrando}
            onClick={() =>
              empezarBorrado(async () => {
                const r = await borrarPromo(promo.id);
                setAvisoBorrado(r.error ?? r.ok ?? null);
              })
            }
            className="inline-flex h-10 items-center gap-2 rounded-lg border px-3.5 text-base font-medium text-destructive transition-colors hover:bg-muted disabled:opacity-60"
          >
            {borrando ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="h-4 w-4" />
            )}
            Borrar
          </button>
        )}

        {estado.error && <p className="text-base text-destructive">{estado.error}</p>}
        {estado.ok && <p className="text-base text-muted-foreground">{estado.ok}</p>}
        {avisoBorrado && (
          <p className="text-base text-muted-foreground">{avisoBorrado}</p>
        )}
      </div>
    </form>
  );
}

function Campo({
  nombre,
  etiqueta,
  valorInicial,
  placeholder,
  ayuda,
  tipo = "text",
  requerido = false,
}: {
  nombre: string;
  etiqueta: string;
  valorInicial: string;
  placeholder?: string;
  ayuda?: string;
  tipo?: string;
  requerido?: boolean;
}) {
  const id = useId();

  return (
    <div>
      <label htmlFor={id} className="block text-base font-medium">
        {etiqueta}
      </label>
      <input
        id={id}
        name={nombre}
        type={tipo}
        required={requerido}
        defaultValue={valorInicial}
        placeholder={placeholder}
        className="mt-1 h-10 w-full rounded-lg border bg-background px-3 text-base"
      />
      {ayuda && <p className="mt-1 text-sm text-muted-foreground">{ayuda}</p>}
    </div>
  );
}
