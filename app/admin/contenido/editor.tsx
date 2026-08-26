"use client";

import { useActionState, useState } from "react";
import { Check, Eye, Loader2, Pencil, Plus, TriangleAlert } from "lucide-react";
import { guardarArticulo, type EstadoContenido } from "./actions";
import { markdownAHtml } from "@/lib/markdown";
import type { ArticuloAdmin } from "@/lib/dal/admin/contenido";

const inicial: EstadoContenido = {};

/**
 * Editor de notas.
 *
 * Markdown con vista previa al lado, y no un editor visual: el que escribe las
 * notas de una maderera no es un editor profesional, y una barra de herramientas
 * con veinte botones asusta más de lo que ayuda. Cuatro marcas —`##` para
 * títulos, `-` para listas, `**` para negrita y `[texto](url)` para enlaces—
 * alcanzan para todo lo que se publica acá, y se aprenden en un minuto.
 */
export function EditorDeNota({
  articulo,
  categorias,
}: {
  articulo?: ArticuloAdmin;
  categorias: { id: string; nombre: string }[];
}) {
  const [estado, accion, guardando] = useActionState(guardarArticulo, inicial);
  const [abierto, setAbierto] = useState(false);
  const [contenido, setContenido] = useState(articulo?.contenido ?? "");
  const [vista, setVista] = useState<"escribir" | "ver">("escribir");

  if (!abierto) {
    return (
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className={
          articulo
            ? "inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-base font-medium transition-colors hover:bg-muted"
            : "inline-flex h-10 items-center gap-2 rounded-lg bg-brand-orange px-4 text-base font-medium text-white transition-colors hover:bg-brand-orange-dark"
        }
      >
        {articulo ? (
          <>
            <Pencil className="h-4 w-4" />
            Editar
          </>
        ) : (
          <>
            <Plus className="h-5 w-5" />
            Escribir una nota
          </>
        )}
      </button>
    );
  }

  return (
    <section className="tarjeta p-5">
      <h2 className="text-base font-medium">
        {articulo ? `Editar: ${articulo.titulo}` : "Nueva nota"}
      </h2>

      <form action={accion} className="mt-4 space-y-4">
        {articulo && <input type="hidden" name="id" value={articulo.id} />}

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label htmlFor="titulo" className="block text-base font-medium">
              Título
            </label>
            <input
              id="titulo"
              name="titulo"
              required
              defaultValue={articulo?.titulo}
              className="mt-1 h-10 w-full rounded-lg border bg-background px-3 text-base"
            />
            {articulo && (
              <p className="mt-1 text-base text-muted-foreground">
                La dirección de la nota no cambia al editar el título:{" "}
                <span className="tabular">/blog/{articulo.slug}</span>
              </p>
            )}
          </div>

          <div className="sm:col-span-2">
            <label htmlFor="resumen" className="block text-base font-medium">
              Resumen
            </label>
            <input
              id="resumen"
              name="resumen"
              defaultValue={articulo?.resumen}
              placeholder="Si lo dejás vacío, lo armamos con las primeras líneas"
              className="mt-1 h-10 w-full rounded-lg border bg-background px-3 text-base"
            />
            <p className="mt-1 text-base text-muted-foreground">
              Es lo que se lee en la tarjeta del blog y en el resultado de
              Google.
            </p>
          </div>

          <div>
            <label htmlFor="categoryId" className="block text-base font-medium">
              Categoría
            </label>
            <select
              id="categoryId"
              name="categoryId"
              defaultValue={articulo?.categoryId ?? ""}
              className="mt-1 h-10 w-full rounded-lg border bg-background px-3 text-base"
            >
              <option value="">Sin categoría</option>
              {categorias.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nombre}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="imagen" className="block text-base font-medium">
              Imagen de portada
            </label>
            <input
              id="imagen"
              name="imagen"
              type="file"
              accept="image/jpeg,image/png,image/webp,image/avif"
              className="mt-1 h-10 w-full rounded-lg border bg-background px-3 py-1.5 text-base"
            />
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-base font-medium">Cuerpo de la nota</span>
            <div className="flex gap-1">
              <Pestana
                activa={vista === "escribir"}
                onClick={() => setVista("escribir")}
              >
                <Pencil className="h-4 w-4" />
                Escribir
              </Pestana>
              <Pestana activa={vista === "ver"} onClick={() => setVista("ver")}>
                <Eye className="h-4 w-4" />
                Vista previa
              </Pestana>
            </div>
          </div>

          {vista === "escribir" ? (
            <>
              <textarea
                name="contenido"
                rows={16}
                required
                value={contenido}
                onChange={(e) => setContenido(e.target.value)}
                className="mt-1 w-full rounded-lg border bg-background px-3 py-2 font-mono text-base"
              />
              <p className="mt-1 text-base text-muted-foreground">
                <span className="tabular">## Título</span> ·{" "}
                <span className="tabular">- ítem de lista</span> ·{" "}
                <span className="tabular">**negrita**</span> ·{" "}
                <span className="tabular">[texto](/catalogo)</span>
              </p>
            </>
          ) : (
            <>
              <input type="hidden" name="contenido" value={contenido} />
              <div
                className="nota-cuerpo mt-1 min-h-[20rem] rounded-lg border bg-background px-4 py-3"
                dangerouslySetInnerHTML={{ __html: markdownAHtml(contenido) }}
              />
            </>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-5">
          <label className="flex items-center gap-2 text-base">
            <input
              type="checkbox"
              name="publicar"
              defaultChecked={articulo?.estado === "publicado"}
              className="h-4 w-4"
            />
            Publicar ahora
          </label>
          <label className="flex items-center gap-2 text-base">
            <input
              type="checkbox"
              name="destacado"
              defaultChecked={articulo?.destacado}
              className="h-4 w-4"
            />
            Destacar arriba de todo
          </label>
        </div>

        {estado.error && (
          <p className="flex items-start gap-2 text-base text-destructive">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            {estado.error}
          </p>
        )}

        {estado.ok && (
          <p className="flex items-center gap-2 text-base text-muted-foreground">
            <Check className="h-4 w-4 text-brand-green" />
            {estado.ok}
          </p>
        )}

        <div className="flex gap-2">
          <button
            type="submit"
            disabled={guardando}
            className="inline-flex h-10 items-center gap-2 rounded-lg bg-brand-orange px-4 text-base font-medium text-white transition-colors hover:bg-brand-orange-dark disabled:opacity-60"
          >
            {guardando && <Loader2 className="h-4 w-4 animate-spin" />}
            Guardar
          </button>
          <button
            type="button"
            onClick={() => setAbierto(false)}
            className="inline-flex h-10 items-center rounded-lg border px-4 text-base font-medium transition-colors hover:bg-muted"
          >
            Cerrar
          </button>
        </div>
      </form>
    </section>
  );
}

function Pestana({
  activa,
  onClick,
  children,
}: {
  activa: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={activa}
      className={`inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-base font-medium transition-colors ${
        activa ? "bg-muted" : "hover:bg-muted/60"
      }`}
    >
      {children}
    </button>
  );
}
