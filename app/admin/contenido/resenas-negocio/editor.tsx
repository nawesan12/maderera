"use client";

import { useActionState, useState, useTransition } from "react";
import {
  Download,
  Eye,
  Loader2,
  MessageSquareQuote,
  Star,
  Trash2,
} from "lucide-react";
import {
  borrarResenaDelNegocio,
  guardarResenaDelNegocio,
  publicarResena,
  traerDeGoogle,
  type EstadoResena,
} from "./actions";
import {
  Hoja,
  Interruptor,
  Opciones,
  Seccion,
  sinReiniciar,
} from "@/components/admin/formulario";

const inicial: EstadoResena = {};

export interface ResenaEditable {
  id: string;
  autor: string;
  estrellas: number;
  texto: string;
  /** "2026-03-15", como lo espera el input de fecha. */
  fecha: string;
  origen: "manual" | "google";
  publicada: boolean;
}

export function EditorDeResenas({
  resenas,
  hayGoogle,
}: {
  resenas: ResenaEditable[];
  hayGoogle: boolean;
}) {
  const [estado, guardar, guardando] = useActionState(
    guardarResenaDelNegocio,
    inicial,
  );
  const [trayendo, empezarTraida] = useTransition();
  const [aviso, setAviso] = useState<string | null>(null);

  return (
    <div className="space-y-5">
      {hayGoogle && (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={trayendo}
            onClick={() =>
              empezarTraida(async () => {
                const r = await traerDeGoogle();
                setAviso(r.error ?? r.ok ?? null);
              })
            }
            className="inline-flex h-10 items-center gap-2 rounded-lg border px-3.5 text-base font-medium transition-colors hover:bg-muted disabled:opacity-60"
          >
            {trayendo ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Download className="h-4 w-4" />
            )}
            Traer las de Google
          </button>
          {aviso && (
            <span className="text-base text-muted-foreground">{aviso}</span>
          )}
        </div>
      )}

      <ul className="space-y-3">
        {resenas.map((resena) => (
          <Fila key={resena.id} resena={resena} />
        ))}
      </ul>

      <form {...sinReiniciar(guardar)} className="space-y-4">
        <Hoja>
          <Seccion titulo="Cargar una reseña" icono={MessageSquareQuote}>
            <label className="block">
              <span className="text-base font-medium">Quién la escribió</span>
              <input
                name="autor"
                required
                className="mt-1 h-11 w-full rounded-lg border bg-background px-3 text-base"
              />
            </label>
            <label className="block">
              <span className="text-base font-medium">Cuándo</span>
              <input
                name="fecha"
                type="date"
                className="tabular mt-1 h-11 w-full rounded-lg border bg-background px-3 text-base"
              />
            </label>
            <div className="md:col-span-2">
              <p className="text-base font-medium">Estrellas</p>
              <div className="mt-1">
                <Opciones
                  nombre="estrellas"
                  defecto="5"
                  opciones={[5, 4, 3, 2, 1].map((n) => ({
                    valor: String(n),
                    texto: String(n),
                    icono: Star,
                  }))}
                />
              </div>
            </div>
            <label className="block md:col-span-2">
              <span className="text-base font-medium">La reseña</span>
              <textarea
                name="texto"
                required
                rows={3}
                className="mt-1 w-full rounded-lg border bg-background px-3 py-2 text-base"
              />
            </label>
            <div className="md:col-span-2">
              <Interruptor
                nombre="publicada"
                etiqueta="Mostrarla en el sitio"
                icono={Eye}
                defecto
              />
            </div>
          </Seccion>
        </Hoja>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={guardando}
            className="inline-flex h-10 items-center gap-2 rounded-lg bg-accion px-4 text-base font-medium text-white transition-colors hover:bg-brand-orange-dark disabled:opacity-60"
          >
            {guardando && <Loader2 className="h-4 w-4 animate-spin" />}
            Guardar
          </button>
          {(estado.error || estado.ok) && (
            <span
              className={`text-base ${estado.error ? "text-destructive" : "text-muted-foreground"}`}
            >
              {estado.error ?? estado.ok}
            </span>
          )}
        </div>
      </form>
    </div>
  );
}

function Fila({ resena }: { resena: ResenaEditable }) {
  const [trabajando, empezar] = useTransition();
  const [aviso, setAviso] = useState<string | null>(null);

  return (
    <li className="tarjeta p-4">
      <div className="flex flex-wrap items-start gap-3">
        <span className="flex items-center gap-0.5 text-brand-orange">
          {Array.from({ length: resena.estrellas }, (_, i) => (
            <Star key={i} className="h-4 w-4 fill-current" />
          ))}
        </span>

        <div className="min-w-[14rem] flex-1">
          <p className="text-base font-medium">
            {resena.autor}
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              {resena.fecha}
              {resena.origen === "google" && " · de Google"}
            </span>
          </p>
          <p className="mt-0.5 text-base text-muted-foreground">
            {resena.texto}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={trabajando}
            onClick={() =>
              empezar(async () => {
                const r = await publicarResena(resena.id, !resena.publicada);
                setAviso(r.error ?? null);
              })
            }
            className={`h-10 rounded-lg px-3.5 text-base font-medium transition-colors ${
              resena.publicada
                ? "border border-linea hover:bg-hundida"
                : "bg-accion text-white hover:bg-brand-orange-dark"
            }`}
          >
            {resena.publicada ? "Sacar del sitio" : "Publicar"}
          </button>

          <button
            type="button"
            disabled={trabajando}
            onClick={() =>
              empezar(async () => {
                const r = await borrarResenaDelNegocio(resena.id);
                setAviso(r.error ?? null);
              })
            }
            aria-label={`Borrar la reseña de ${resena.autor}`}
            className="flex h-10 w-10 items-center justify-center rounded-lg border border-linea text-muted-foreground transition-colors hover:text-destructive"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      {aviso && <p className="mt-2 text-sm text-destructive">{aviso}</p>}
    </li>
  );
}
