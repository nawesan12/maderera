"use client";

import { useActionState } from "react";
import { Check, Eye, EyeOff, Loader2, Plus, TriangleAlert } from "lucide-react";
import {
  bajaTestimonio,
  cambiarEstadoArticulo,
  crearCategoria,
  guardarAjuste,
  guardarTestimonio,
  type EstadoContenido,
} from "./actions";
import type { Testimonial, SiteSetting } from "@/lib/db/schema";

const inicial: EstadoContenido = {};

/** Publicar o despublicar una nota, sin abrir el editor. */
export function AccionesNota({ id, estado }: { id: string; estado: string }) {
  const [resultado, cambiar, cambiando] = useActionState(
    cambiarEstadoArticulo,
    inicial,
  );

  const siguiente = estado === "publicado" ? "borrador" : "publicado";

  return (
    <form action={cambiar} className="flex items-center gap-2">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="estado" value={siguiente} />
      <button
        type="submit"
        disabled={cambiando}
        className={`inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-base font-medium transition-colors disabled:opacity-60 ${
          estado === "publicado"
            ? "border hover:bg-muted"
            : "bg-brand-orange text-white hover:bg-brand-orange-dark"
        }`}
      >
        {cambiando ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : estado === "publicado" ? (
          <EyeOff className="h-4 w-4" />
        ) : (
          <Eye className="h-4 w-4" />
        )}
        {estado === "publicado" ? "Despublicar" : "Publicar"}
      </button>

      {resultado.ok && (
        <span className="text-base text-muted-foreground">{resultado.ok}</span>
      )}
    </form>
  );
}

export function NuevaCategoria() {
  const [estado, crear, creando] = useActionState(crearCategoria, inicial);

  return (
    <form action={crear} className="flex flex-wrap items-end gap-2">
      <div className="min-w-[12rem] flex-1">
        <label htmlFor="categoria-nueva" className="block text-base font-medium">
          Nueva categoría
        </label>
        <input
          id="categoria-nueva"
          name="nombre"
          required
          placeholder="Techos"
          className="mt-1 h-10 w-full rounded-lg border bg-background px-3 text-base"
        />
      </div>
      <button
        type="submit"
        disabled={creando}
        className="inline-flex h-10 items-center gap-2 rounded-lg border px-4 text-base font-medium transition-colors hover:bg-muted disabled:opacity-60"
      >
        {creando ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Plus className="h-4 w-4" />
        )}
        Agregar
      </button>

      {estado.error && (
        <p className="w-full text-base text-destructive">{estado.error}</p>
      )}
      {estado.ok && (
        <p className="w-full text-base text-muted-foreground">{estado.ok}</p>
      )}
    </form>
  );
}

export function Testimonios({ testimonios }: { testimonios: Testimonial[] }) {
  const [estadoAlta, agregar, agregando] = useActionState(
    guardarTestimonio,
    inicial,
  );
  const [, baja] = useActionState(bajaTestimonio, inicial);

  return (
    <div className="space-y-4">
      <ul className="divide-y rounded-lg border">
        {testimonios.length === 0 && (
          <li className="px-4 py-6 text-center text-base text-muted-foreground">
            Todavía no hay testimonios cargados.
          </li>
        )}

        {testimonios.map((t) => (
          <li
            key={t.id}
            className={`flex flex-wrap items-start gap-x-4 gap-y-2 px-4 py-3 ${
              t.activo ? "" : "opacity-60"
            }`}
          >
            <div className="min-w-[12rem] flex-1">
              <p className="text-base font-medium">
                {t.nombre}
                {t.rol && (
                  <span className="font-normal text-muted-foreground">
                    {" "}
                    · {t.rol}
                  </span>
                )}
              </p>
              <p className="text-base text-muted-foreground">“{t.texto}”</p>
            </div>

            <form action={baja}>
              <input type="hidden" name="id" value={t.id} />
              <button
                type="submit"
                className="inline-flex h-9 items-center rounded-lg border px-3 text-base font-medium transition-colors hover:bg-muted"
              >
                {t.activo ? "Ocultar" : "Mostrar"}
              </button>
            </form>
          </li>
        ))}
      </ul>

      <form action={agregar} className="grid gap-3 sm:grid-cols-2">
        <input
          name="nombre"
          required
          placeholder="Nombre"
          className="h-10 rounded-lg border bg-background px-3 text-base"
        />
        <input
          name="rol"
          placeholder="Arquitecta · Estudio CM"
          className="h-10 rounded-lg border bg-background px-3 text-base"
        />
        <textarea
          name="texto"
          required
          rows={2}
          placeholder="Qué dijo, tal cual lo dijo"
          className="rounded-lg border bg-background px-3 py-2 text-base sm:col-span-2"
        />

        {estadoAlta.error && (
          <p className="flex items-start gap-2 text-base text-destructive sm:col-span-2">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            {estadoAlta.error}
          </p>
        )}
        {estadoAlta.ok && (
          <p className="flex items-center gap-2 text-base text-muted-foreground sm:col-span-2">
            <Check className="h-4 w-4 text-brand-green" />
            {estadoAlta.ok}
          </p>
        )}

        <div className="sm:col-span-2">
          <button
            type="submit"
            disabled={agregando}
            className="inline-flex h-10 items-center gap-2 rounded-lg border px-4 text-base font-medium transition-colors hover:bg-muted disabled:opacity-60"
          >
            {agregando ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
            Agregar testimonio
          </button>
        </div>
      </form>
    </div>
  );
}

/**
 * Textos sueltos del sitio.
 *
 * Cada ajuste se guarda por su cuenta, con su propio formulario: un botón
 * "guardar todo" obligaría a revisar qué cambió y arriesga pisar lo que otra
 * persona editó en otra pestaña.
 */
export function Ajustes({ ajustes }: { ajustes: SiteSetting[] }) {
  const [estado, guardar, guardando] = useActionState(guardarAjuste, inicial);

  return (
    <div className="space-y-4">
      {ajustes.map((a) => (
        <form key={a.clave} action={guardar} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="clave" value={a.clave} />

          <div className="min-w-[16rem] flex-1">
            <label htmlFor={`ajuste-${a.clave}`} className="block text-base font-medium">
              {a.descripcion ?? a.clave}
            </label>
            <input
              id={`ajuste-${a.clave}`}
              name="valor"
              defaultValue={a.valor}
              className="mt-1 h-10 w-full rounded-lg border bg-background px-3 text-base"
            />
          </div>

          <button
            type="submit"
            disabled={guardando}
            className="inline-flex h-10 items-center rounded-lg border px-4 text-base font-medium transition-colors hover:bg-muted disabled:opacity-60"
          >
            Guardar
          </button>
        </form>
      ))}

      {estado.ok && (
        <p className="flex items-center gap-2 text-base text-muted-foreground">
          <Check className="h-4 w-4 text-brand-green" />
          {estado.ok}
        </p>
      )}
      {estado.error && (
        <p className="text-base text-destructive">{estado.error}</p>
      )}
    </div>
  );
}
